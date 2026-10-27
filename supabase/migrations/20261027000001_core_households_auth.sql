-- =====================================================================================
-- Pierre Casa — núcleo: casas, membros, convites, preferências, helpers e RPCs de associação.
--
-- Segurança (resumo):
--  * RLS ligada em TODAS as tabelas. Políticas verificam a associação do usuário à casa.
--  * Escritas sensíveis (criar casa, aceitar convite, papéis) só via RPC SECURITY DEFINER,
--    que valida auth.uid() no servidor. O cliente nunca escolhe o próprio papel nem a casa.
--  * Tokens de convite: 244 bits aleatórios, exibidos UMA vez; só o hash SHA-256 é guardado.
-- Pré-requisito: schema `auth` do Supabase (auth.users, auth.uid()).
-- =====================================================================================

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- "Hoje" no fuso do produto (Brasil). Usado por views e rotinas de agendamento.
create or replace function public.app_today() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- ------------------------------------------------------------------------------------
-- households
-- ------------------------------------------------------------------------------------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  currency char(3) not null default 'BRL' check (currency = 'BRL'), -- sem conversão de moedas
  max_members smallint not null default 2 check (max_members between 1 and 10),
  monthly_savings_goal_cents bigint check (monthly_savings_goal_cents is null or monthly_savings_goal_cents >= 0),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.households.max_members is 'Regra inicial: 2 membros ativos. Aplicada por trigger com lock na linha da casa (sem corrida).';
create trigger households_updated_at before update on public.households
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------------------
-- household_members
-- ------------------------------------------------------------------------------------
create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, user_id) -- alvo das FKs compostas (garante que "dono" pertence à casa)
);
-- Um usuário participa de no máximo uma casa ativa (simplifica o "contexto atual").
create unique index if not exists household_members_one_active_house
  on public.household_members (user_id) where is_active;
create index if not exists household_members_household_idx on public.household_members (household_id) where is_active;
create trigger household_members_updated_at before update on public.household_members
  for each row execute function public.set_updated_at();

-- Helpers de autorização (SECURITY DEFINER evita recursão de RLS em household_members).
create or replace function public.is_household_member(p_household uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = auth.uid() and m.is_active
  )
$$;

create or replace function public.is_household_admin(p_household uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = auth.uid() and m.is_active and m.role = 'admin'
  )
$$;

-- Limite de membros ativos, sem condição de corrida: o lock na linha da casa serializa inserts concorrentes.
create or replace function public.enforce_member_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_max int;
  v_count int;
begin
  if new.is_active then
    select max_members into v_max from public.households where id = new.household_id for update;
    select count(*) into v_count from public.household_members
      where household_id = new.household_id and is_active and id <> new.id;
    if v_count >= v_max then
      raise exception 'Esta casa já atingiu o limite de membros.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger household_members_limit before insert or update of is_active on public.household_members
  for each row execute function public.enforce_member_limit();

-- ------------------------------------------------------------------------------------
-- household_invitations
-- ------------------------------------------------------------------------------------
create table if not exists public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token_hash text not null unique, -- SHA-256 hex do token; o token em si nunca é gravado
  email text check (email is null or char_length(email) <= 254),
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists household_invitations_household_idx on public.household_invitations (household_id);

-- ------------------------------------------------------------------------------------
-- user_preferences
-- ------------------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  pierre_enabled boolean not null default true,
  pierre_min_periods smallint not null default 3 check (pierre_min_periods between 2 and 12),
  history_variance_pct smallint not null default 30 check (history_variance_pct between 5 and 300),
  default_alert_pct smallint not null default 80 check (default_alert_pct between 1 and 100),
  installment_policy text not null default 'parcel' check (installment_policy in ('parcel', 'purchase')),
  default_view text not null default 'joint' check (default_view in ('joint', 'person')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------------------
-- Idempotência de operações (cliques duplos, reenvios, concorrência)
-- ------------------------------------------------------------------------------------
create table if not exists public.operation_requests (
  household_id uuid not null references public.households (id) on delete cascade,
  request_id uuid not null,
  user_id uuid not null,
  op text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (household_id, request_id)
);
comment on table public.operation_requests is 'Chaves de idempotência. Sem acesso direto do cliente; usada só pelas RPCs.';

create or replace function public._require_user() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function public._require_member(p_household uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid := public._require_user();
begin
  if not public.is_household_member(p_household) then
    raise exception 'Você não tem acesso a esta casa.' using errcode = '42501';
  end if;
  return v;
end $$;

-- Inicia uma operação idempotente: serializa por (casa, request_id) e devolve o resultado já gravado, se houver.
create or replace function public._op_begin(p_household uuid, p_request uuid, p_op text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.operation_requests;
begin
  if p_request is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text || ':' || p_request::text, 0));
  select * into r from public.operation_requests where household_id = p_household and request_id = p_request;
  if found then
    if r.user_id <> auth.uid() or r.op <> p_op then
      raise exception 'Chave de requisição já utilizada em outra operação.' using errcode = '22023';
    end if;
    return r.result;
  end if;
  return null;
end $$;

create or replace function public._op_end(p_household uuid, p_request uuid, p_op text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_request is not null then
    insert into public.operation_requests (household_id, request_id, user_id, op, result)
    values (p_household, p_request, auth.uid(), p_op, p_result);
  end if;
  return p_result;
end $$;

-- ------------------------------------------------------------------------------------
-- RLS: households / members / invitations / preferences
-- ------------------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
alter table public.user_preferences enable row level security;
alter table public.operation_requests enable row level security; -- sem políticas = ninguém acessa direto

create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (public.is_household_admin(id)) with check (public.is_household_admin(id));

create policy members_select on public.household_members for select to authenticated
  using (public.is_household_member(household_id));
-- Cada pessoa edita apenas o PRÓPRIO nome de exibição (GRANT de coluna impede mexer em papel/casa).
create policy members_update_self on public.household_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy invitations_select_admin on public.household_invitations for select to authenticated
  using (public.is_household_admin(household_id));

create policy prefs_select on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy prefs_insert on public.user_preferences for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_member(household_id));
create policy prefs_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_household_member(household_id));

-- ------------------------------------------------------------------------------------
-- RPCs de casa e convite
-- ------------------------------------------------------------------------------------
create or replace function public.create_household(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := public._require_user();
  v_house uuid;
begin
  if exists (select 1 from public.household_members where user_id = v_user and is_active) then
    raise exception 'Você já participa de uma casa.' using errcode = 'P0001';
  end if;
  insert into public.households (name, created_by) values (btrim(p_name), v_user) returning id into v_house;
  insert into public.household_members (household_id, user_id, role, display_name)
    values (v_house, v_user, 'admin', btrim(p_display_name));
  insert into public.user_preferences (user_id, household_id) values (v_user, v_house)
    on conflict (user_id) do update set household_id = excluded.household_id;
  perform public._seed_default_categories(v_house);
  return v_house;
end $$;

create or replace function public.create_invitation(p_household_id uuid, p_email text default null, p_valid_hours int default 168)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := public._require_user();
  v_token text;
  v_id uuid;
  v_exp timestamptz;
begin
  if not public.is_household_admin(p_household_id) then
    raise exception 'Somente administradores podem convidar.' using errcode = '42501';
  end if;
  if p_valid_hours < 1 or p_valid_hours > 720 then
    raise exception 'Validade inválida.' using errcode = '22023';
  end if;
  if (select count(*) from public.household_invitations
        where household_id = p_household_id and used_at is null and revoked_at is null and expires_at > now()) >= 5 then
    raise exception 'Há convites pendentes demais. Revogue algum antes de criar outro.' using errcode = 'P0001';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); -- 2 × 122 bits CSPRNG
  v_exp := now() + make_interval(hours => p_valid_hours);
  insert into public.household_invitations (household_id, token_hash, email, created_by, expires_at)
  values (p_household_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), nullif(btrim(p_email), ''), v_user, v_exp)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp);
end $$;

create or replace function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_house uuid;
begin
  perform public._require_user();
  select household_id into v_house from public.household_invitations where id = p_invitation_id;
  if v_house is null or not public.is_household_admin(v_house) then
    raise exception 'Convite não encontrado.' using errcode = '42501';
  end if;
  update public.household_invitations set revoked_at = now() where id = p_invitation_id and used_at is null;
end $$;

-- Mensagem de erro única para token inexistente/expirado/usado: não permite enumerar convites.
create or replace function public.accept_invitation(p_token text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := public._require_user();
  inv public.household_invitations;
begin
  if exists (select 1 from public.household_members where user_id = v_user and is_active) then
    raise exception 'Você já participa de uma casa.' using errcode = 'P0001';
  end if;
  select * into inv from public.household_invitations
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    for update;
  if not found or inv.used_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'Convite inválido ou expirado.' using errcode = 'P0001';
  end if;
  insert into public.household_members (household_id, user_id, role, display_name)
    values (inv.household_id, v_user, 'member', btrim(p_display_name)); -- papel sempre 'member'; trigger valida o limite
  update public.household_invitations set used_at = now(), used_by = v_user where id = inv.id;
  insert into public.user_preferences (user_id, household_id) values (v_user, inv.household_id)
    on conflict (user_id) do update set household_id = excluded.household_id;
  return inv.household_id;
end $$;

create or replace function public.remove_member(p_member_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.household_members;
begin
  perform public._require_user();
  select * into m from public.household_members where id = p_member_id;
  if not found or not public.is_household_admin(m.household_id) then
    raise exception 'Membro não encontrado.' using errcode = '42501';
  end if;
  if m.user_id = auth.uid() then
    raise exception 'Você não pode remover a si mesmo.' using errcode = 'P0001';
  end if;
  update public.household_members set is_active = false where id = p_member_id; -- histórico financeiro é preservado
end $$;
