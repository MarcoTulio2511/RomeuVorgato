-- =====================================================================================
-- Pierre Casa — modelo financeiro.
--
-- Convenções:
--  * Valores em CENTAVOS (bigint), sempre positivos; o sentido vem de `type`.
--  * Toda tabela financeira tem household_id. Referências usam FKs COMPOSTAS (household_id, x_id),
--    o que impede, no banco, qualquer vínculo entre casas diferentes.
--  * `transactions` e demais tabelas "atômicas" NÃO aceitam escrita direta do cliente: só via RPC.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- categories
-- ------------------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  parent_id uuid,
  color text not null default '#c8f542' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text check (icon is null or char_length(icon) <= 40),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, parent_id) references public.categories (household_id, id) on delete restrict,
  check (parent_id is null or parent_id <> id)
);
create unique index if not exists categories_unique_name
  on public.categories (household_id, kind, lower(btrim(name)), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));
create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- Subcategoria precisa ter o mesmo tipo do pai (evita "despesa" dentro de "receita").
create or replace function public.categories_check_parent() returns trigger
language plpgsql as $$
declare v_kind text;
begin
  if new.parent_id is not null then
    select kind into v_kind from public.categories where id = new.parent_id and household_id = new.household_id;
    if v_kind is distinct from new.kind then
      raise exception 'A subcategoria deve ter o mesmo tipo da categoria-pai.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger categories_parent_check before insert or update of parent_id, kind on public.categories
  for each row execute function public.categories_check_parent();

-- ------------------------------------------------------------------------------------
-- accounts
-- ------------------------------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  institution text check (institution is null or char_length(institution) <= 60),
  type text not null check (type in ('checking', 'savings', 'cash', 'digital_wallet')),
  initial_balance_cents bigint not null default 0 check (abs(initial_balance_cents) <= 10000000000000),
  -- Saldo inicial = saldo REAL no INÍCIO desta data. Movimentos anteriores NÃO alteram o saldo retroativamente.
  balance_date date not null default public.app_today(),
  is_active boolean not null default true,
  include_in_consolidated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id)
);
create index if not exists accounts_household_idx on public.accounts (household_id);
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------------------
-- credit_cards  (NUNCA guardar número completo, CVV ou senha)
-- ------------------------------------------------------------------------------------
create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  institution text check (institution is null or char_length(institution) <= 60),
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  limit_cents bigint not null default 0 check (limit_cents between 0 and 10000000000000),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  -- Compra feita NO dia do fechamento: 'next' = vai para a próxima fatura (padrão); 'current' = fica na que fecha.
  closing_day_rule text not null default 'next' check (closing_day_rule in ('next', 'current')),
  pay_account_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id),
  foreign key (household_id, pay_account_id) references public.accounts (household_id, id) on delete set null (pay_account_id)
);
create trigger credit_cards_updated_at before update on public.credit_cards
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------------------
-- Ciclo de fatura (espelha src/domain/invoices/invoices.ts — paridade testada)
-- ------------------------------------------------------------------------------------
create or replace function public._month_start(d date) returns date
language sql immutable as $$ select d - (extract(day from d)::int - 1) $$;

create or replace function public._clamp_day(p_month date, p_day int) returns date
language sql immutable as $$
  select public._month_start(p_month)
         + (least(p_day, extract(day from (public._month_start(p_month) + interval '1 month' - interval '1 day'))::int) - 1)
$$;

create or replace function public._add_months(d date, n int) returns date
language sql immutable as $$ select (d + make_interval(months => n))::date $$;

create or replace function public._card_closing_for(p_closing_day int, p_rule text, p_purchase date) returns date
language sql immutable as $$
  select case
    when (case when p_rule = 'next' then p_purchase < public._clamp_day(p_purchase, p_closing_day)
               else p_purchase <= public._clamp_day(p_purchase, p_closing_day) end)
      then public._clamp_day(p_purchase, p_closing_day)
    else public._clamp_day(public._add_months(public._month_start(p_purchase), 1), p_closing_day)
  end
$$;

create or replace function public._card_cycle(p_closing_day int, p_due_day int, p_rule text, p_closing date)
returns table (cycle_start date, cycle_end date, closing_date date, due_date date)
language sql immutable as $$
  select
    case when p_rule = 'next'
         then public._clamp_day(public._add_months(public._month_start(p_closing), -1), p_closing_day)
         else public._clamp_day(public._add_months(public._month_start(p_closing), -1), p_closing_day) + 1 end,
    case when p_rule = 'next' then p_closing - 1 else p_closing end,
    p_closing,
    case when public._clamp_day(p_closing, p_due_day) > p_closing
         then public._clamp_day(p_closing, p_due_day)
         else public._clamp_day(public._add_months(public._month_start(p_closing), 1), p_due_day) end
$$;

-- ------------------------------------------------------------------------------------
-- card_invoices — o TOTAL é derivado (view v_card_invoices); não é armazenado, para não divergir.
-- ------------------------------------------------------------------------------------
create table if not exists public.card_invoices (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  card_id uuid not null,
  cycle_start date not null,
  cycle_end date not null,
  closing_date date not null,
  due_date date not null,
  created_at timestamptz not null default now(),
  check (cycle_start <= cycle_end),
  check (due_date > closing_date),
  unique (card_id, closing_date),
  unique (household_id, card_id, id),
  foreign key (household_id, card_id) references public.credit_cards (household_id, id) on delete cascade
);
create index if not exists card_invoices_card_idx on public.card_invoices (card_id, due_date);

-- Cria (ou reaproveita) a fatura de um cartão para uma data de fechamento. Idempotente e segura contra corrida.
create or replace function public._ensure_invoice_by_closing(p_card uuid, p_closing date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.credit_cards;
  cy record;
  v_id uuid;
begin
  select * into c from public.credit_cards where id = p_card;
  if not found then raise exception 'Cartão não encontrado.' using errcode = 'P0002'; end if;
  select * into cy from public._card_cycle(c.closing_day, c.due_day, c.closing_day_rule, p_closing);
  insert into public.card_invoices (household_id, card_id, cycle_start, cycle_end, closing_date, due_date)
  values (c.household_id, c.id, cy.cycle_start, cy.cycle_end, cy.closing_date, cy.due_date)
  on conflict (card_id, closing_date) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.card_invoices where card_id = p_card and closing_date = p_closing;
  end if;
  return v_id;
end $$;

create or replace function public._ensure_invoice(p_card uuid, p_purchase date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.credit_cards;
begin
  select * into c from public.credit_cards where id = p_card;
  if not found then raise exception 'Cartão não encontrado.' using errcode = 'P0002'; end if;
  return public._ensure_invoice_by_closing(p_card, public._card_closing_for(c.closing_day, c.closing_day_rule, p_purchase));
end $$;

-- ------------------------------------------------------------------------------------
-- installment_plans (um plano = uma despesa econômica; parcelas = obrigações por ciclo)
-- ------------------------------------------------------------------------------------
create table if not exists public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  total_cents bigint not null check (total_cents > 0 and total_cents <= 10000000000000),
  installment_count smallint not null check (installment_count between 1 and 48),
  purchase_date date not null,
  card_id uuid not null,
  category_id uuid,
  owner_id uuid not null,
  scope text not null default 'individual' check (scope in ('individual', 'shared')),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (total_cents >= installment_count), -- ao menos 1 centavo por parcela
  unique (household_id, id),
  foreign key (household_id, card_id) references public.credit_cards (household_id, id),
  foreign key (household_id, category_id) references public.categories (household_id, id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id)
);

-- ------------------------------------------------------------------------------------
-- transactions
-- ------------------------------------------------------------------------------------
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid not null,
  account_id uuid,
  card_id uuid,
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_format text not null check (file_format in ('csv', 'ofx')),
  file_hash text not null check (char_length(file_hash) between 16 and 128),
  status text not null default 'preview' check (status in ('preview', 'confirmed', 'cancelled', 'reverted')),
  mapping jsonb not null default '{}'::jsonb,
  total_rows int not null default 0,
  valid_rows int not null default 0,
  invalid_rows int not null default 0,
  duplicate_rows int not null default 0,
  imported_rows int not null default 0,
  repeated_file boolean not null default false,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (household_id, id),
  foreign key (household_id, account_id) references public.accounts (household_id, id),
  foreign key (household_id, card_id) references public.credit_cards (household_id, id),
  foreign key (household_id, created_by) references public.household_members (household_id, user_id),
  check ((account_id is not null) <> (card_id is not null)) -- destino é conta XOU cartão
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  type text not null check (type in (
    'income', 'expense', 'refund', 'transfer_out', 'transfer_in',
    'card_purchase', 'card_refund', 'card_fee', 'invoice_payment', 'adjustment_in', 'adjustment_out')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 10000000000000),
  occurred_on date not null,                       -- competência / ocorrência financeira
  registered_at timestamptz not null default now(), -- data de registro
  description text not null check (char_length(btrim(description)) between 1 and 200),
  category_id uuid,
  owner_id uuid not null,                           -- titular/responsável
  created_by uuid not null,
  account_id uuid,
  card_id uuid,
  scope text not null default 'individual' check (scope in ('individual', 'shared')),
  status text not null default 'posted' check (status in ('posted', 'pending', 'cancelled')),
  notes text check (notes is null or char_length(notes) <= 1000),
  source text not null default 'manual' check (source in ('manual', 'import', 'recurring', 'system')),
  source_id text check (source_id is null or char_length(source_id) <= 120),            -- ex.: FITID do OFX
  source_fingerprint text check (source_fingerprint is null or char_length(source_fingerprint) <= 160),
  import_batch_id uuid,
  transfer_group_id uuid,
  invoice_id uuid,
  installment_plan_id uuid,
  installment_number smallint,
  reversal_of_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (household_id, id),
  foreign key (household_id, category_id) references public.categories (household_id, id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id),
  foreign key (household_id, account_id) references public.accounts (household_id, id),
  foreign key (household_id, card_id) references public.credit_cards (household_id, id),
  -- a fatura precisa ser do MESMO cartão e da MESMA casa
  foreign key (household_id, card_id, invoice_id) references public.card_invoices (household_id, card_id, id),
  foreign key (household_id, installment_plan_id) references public.installment_plans (household_id, id),
  foreign key (household_id, reversal_of_id) references public.transactions (household_id, id),
  foreign key (household_id, import_batch_id) references public.import_batches (household_id, id),

  -- combinações válidas entre tipo, conta, cartão e fatura
  constraint tx_account_types check (
    type not in ('income', 'expense', 'refund', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out')
    or (account_id is not null and card_id is null and invoice_id is null)),
  constraint tx_card_types check (
    type not in ('card_purchase', 'card_refund', 'card_fee')
    or (card_id is not null and account_id is null and invoice_id is not null)),
  constraint tx_payment_type check (
    type <> 'invoice_payment' or (card_id is not null and account_id is not null and invoice_id is not null)),
  constraint tx_transfer_group check ((type in ('transfer_in', 'transfer_out')) = (transfer_group_id is not null)),
  constraint tx_installment check (
    (installment_plan_id is null) = (installment_number is null)
    and (installment_plan_id is null or type = 'card_purchase')),
  -- ajustes exigem justificativa (auditável)
  constraint tx_adjustment_reason check (type not in ('adjustment_in', 'adjustment_out') or char_length(btrim(coalesce(notes, ''))) >= 3),
  constraint tx_no_category_for_internal check (type not in ('transfer_in', 'transfer_out', 'invoice_payment') or category_id is null),
  constraint tx_pending_only_card check (status <> 'pending' or type = 'card_purchase')
);
create index if not exists transactions_household_date_idx on public.transactions (household_id, occurred_on desc, created_at desc);
create index if not exists transactions_account_idx on public.transactions (account_id, occurred_on) where account_id is not null;
create index if not exists transactions_card_idx on public.transactions (card_id, occurred_on) where card_id is not null;
create index if not exists transactions_invoice_idx on public.transactions (invoice_id) where invoice_id is not null;
create index if not exists transactions_category_idx on public.transactions (category_id) where category_id is not null;
create index if not exists transactions_transfer_idx on public.transactions (transfer_group_id) where transfer_group_id is not null;
create index if not exists transactions_fingerprint_idx on public.transactions (household_id, source_fingerprint) where source_fingerprint is not null;
-- Deduplicação por identificador estável da origem (ex.: FITID), por conta/cartão.
create unique index if not exists transactions_source_id_unique
  on public.transactions (household_id, coalesce(account_id, card_id), source_id)
  where source_id is not null and status <> 'cancelled';
-- Um parcelamento nunca gera duas vezes a mesma parcela.
create unique index if not exists transactions_installment_unique
  on public.transactions (installment_plan_id, installment_number) where installment_plan_id is not null;
-- Um lançamento só pode ser estornado uma vez.
create unique index if not exists transactions_single_reversal
  on public.transactions (reversal_of_id) where reversal_of_id is not null and status <> 'cancelled';

create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------------------
-- installments (cronograma) + verificação diferida: soma das parcelas == total do plano
-- ------------------------------------------------------------------------------------
create table if not exists public.installments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  plan_id uuid not null,
  number smallint not null check (number >= 1),
  amount_cents bigint not null check (amount_cents > 0),
  competence_date date not null,
  due_date date not null,
  invoice_id uuid,
  transaction_id uuid unique,
  unique (plan_id, number),
  foreign key (household_id, plan_id) references public.installment_plans (household_id, id) on delete cascade,
  foreign key (household_id, transaction_id) references public.transactions (household_id, id),
  foreign key (invoice_id) references public.card_invoices (id)
);

create or replace function public.installments_check_sum() returns trigger
language plpgsql as $$
declare
  v_total bigint;
  v_count int;
  v_sum bigint;
  v_n int;
begin
  select total_cents, installment_count into v_total, v_count from public.installment_plans where id = new.plan_id;
  select coalesce(sum(amount_cents), 0), count(*) into v_sum, v_n from public.installments where plan_id = new.plan_id;
  if v_sum <> v_total or v_n <> v_count then
    raise exception 'As parcelas (%) não somam exatamente o total do plano (%).', v_sum, v_total using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger installments_sum_check after insert on public.installments
  deferrable initially deferred for each row execute function public.installments_check_sum();

-- ------------------------------------------------------------------------------------
-- budgets
-- ------------------------------------------------------------------------------------
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid not null,
  owner_id uuid, -- null = orçamento compartilhado (todos os gastos da categoria)
  limit_cents bigint not null check (limit_cents > 0 and limit_cents <= 10000000000000),
  basis text not null default 'competence' check (basis in ('competence', 'invoice')),
  alert_pct smallint not null default 80 check (alert_pct between 1 and 100),
  per_order_limit_cents bigint check (per_order_limit_cents is null or per_order_limit_cents > 0),
  starts_on date not null default public.app_today(),
  ends_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  foreign key (household_id, category_id) references public.categories (household_id, id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id)
);
create unique index if not exists budgets_one_active
  on public.budgets (household_id, category_id, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active;
create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------------------
-- recurring_transactions / planned_transactions
-- ------------------------------------------------------------------------------------
create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  type text not null check (type in ('income', 'expense')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 10000000000000),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'yearly')),
  interval_count smallint not null default 1 check (interval_count between 1 and 24),
  start_date date not null,
  end_date date,
  owner_id uuid not null,
  account_id uuid,
  card_id uuid,
  category_id uuid,
  scope text not null default 'shared' check (scope in ('individual', 'shared')),
  is_certain boolean not null default true,        -- receita confirmada x estimada
  is_primary_income boolean not null default false, -- define o horizonte "até o próximo salário"
  is_subscription boolean not null default false,
  weekend_rule text not null default 'none' check (weekend_rule in ('none', 'previous_business_day', 'next_business_day')),
  is_active boolean not null default true,
  next_occurrence_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check ((account_id is not null) <> (card_id is not null)),
  check (type = 'expense' or card_id is null),
  unique (household_id, id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id),
  foreign key (household_id, account_id) references public.accounts (household_id, id),
  foreign key (household_id, card_id) references public.credit_cards (household_id, id),
  foreign key (household_id, category_id) references public.categories (household_id, id)
);
create trigger recurring_updated_at before update on public.recurring_transactions
  for each row execute function public.set_updated_at();

create table if not exists public.planned_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recurring_id uuid,
  occurrence_key text not null check (char_length(occurrence_key) between 1 and 80),
  due_date date not null,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  type text not null check (type in ('income', 'expense')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 10000000000000),
  owner_id uuid not null,
  account_id uuid,
  card_id uuid,
  category_id uuid,
  scope text not null default 'shared' check (scope in ('individual', 'shared')),
  status text not null default 'planned' check (status in ('planned', 'realized', 'skipped')),
  transaction_id uuid unique, -- vínculo com o lançamento real quando efetivado
  is_certain boolean not null default true,
  is_primary_income boolean not null default false,
  is_subscription boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'realized') = (transaction_id is not null)),
  check ((account_id is not null) <> (card_id is not null)),
  check (type = 'expense' or card_id is null),
  unique (household_id, occurrence_key), -- idempotência da materialização
  unique (household_id, id),
  foreign key (household_id, recurring_id) references public.recurring_transactions (household_id, id) on delete cascade,
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id),
  foreign key (household_id, account_id) references public.accounts (household_id, id),
  foreign key (household_id, card_id) references public.credit_cards (household_id, id),
  foreign key (household_id, category_id) references public.categories (household_id, id),
  foreign key (household_id, transaction_id) references public.transactions (household_id, id)
);
create index if not exists planned_due_idx on public.planned_transactions (household_id, due_date) where status = 'planned';
create trigger planned_updated_at before update on public.planned_transactions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------------------
-- import_rows
-- ------------------------------------------------------------------------------------
create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  batch_id uuid not null,
  row_number int not null check (row_number >= 0),
  raw jsonb not null default '{}'::jsonb,
  occurred_on date,
  description text check (description is null or char_length(description) <= 200),
  amount_cents bigint check (amount_cents is null or (amount_cents > 0 and amount_cents <= 10000000000000)),
  direction text check (direction is null or direction in ('in', 'out')),
  external_id text check (external_id is null or char_length(external_id) <= 120),
  fingerprint text check (fingerprint is null or char_length(fingerprint) <= 160),
  category_id uuid,
  status text not null check (status in ('valid', 'invalid', 'duplicate', 'review')),
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 300),
  duplicate_of uuid,
  include boolean not null default false,
  transaction_id uuid,
  unique (batch_id, row_number),
  foreign key (household_id, batch_id) references public.import_batches (household_id, id) on delete cascade,
  foreign key (household_id, category_id) references public.categories (household_id, id),
  foreign key (household_id, transaction_id) references public.transactions (household_id, id),
  check (status = 'invalid' or (occurred_on is not null and amount_cents is not null and direction is not null and description is not null))
);
create index if not exists import_rows_batch_idx on public.import_rows (batch_id, row_number);

-- ------------------------------------------------------------------------------------
-- pierre_messages (controle de frequência/deduplicação por usuário)
-- ------------------------------------------------------------------------------------
create table if not exists public.pierre_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rule_id text not null check (char_length(rule_id) <= 60),
  dedupe_key text not null check (char_length(dedupe_key) <= 160),
  severity text not null check (severity in ('info', 'positive', 'warning', 'critical')),
  title text not null check (char_length(title) <= 200),
  body text not null check (char_length(body) <= 600),
  data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  times_shown int not null default 1,
  dismissed_at timestamptz,
  snoozed_until timestamptz,
  unique (user_id, dedupe_key)
);

-- ------------------------------------------------------------------------------------
-- Auditoria de lançamentos (histórico de inserções, edições e cancelamentos)
-- ------------------------------------------------------------------------------------
create table if not exists public.transaction_audit (
  id bigint generated always as identity primary key,
  household_id uuid not null,
  transaction_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);
create index if not exists transaction_audit_tx_idx on public.transaction_audit (transaction_id, changed_at);

create or replace function public.transactions_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.transaction_audit (household_id, transaction_id, action, changed_by, new_row)
    values (new.household_id, new.id, 'insert', auth.uid(), to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    insert into public.transaction_audit (household_id, transaction_id, action, changed_by, old_row, new_row)
    values (new.household_id, new.id, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
  else
    insert into public.transaction_audit (household_id, transaction_id, action, changed_by, old_row)
    values (old.household_id, old.id, 'delete', auth.uid(), to_jsonb(old));
  end if;
  return null;
end $$;
create trigger transactions_audit_trg after insert or update or delete on public.transactions
  for each row execute function public.transactions_audit();

-- ------------------------------------------------------------------------------------
-- View de faturas com total derivado e estado
-- ------------------------------------------------------------------------------------
create or replace view public.v_card_invoices with (security_invoker = on) as
select
  i.id, i.household_id, i.card_id, i.cycle_start, i.cycle_end, i.closing_date, i.due_date,
  coalesce(t.purchases, 0)::bigint as purchases_cents,
  coalesce(t.fees, 0)::bigint as fees_cents,
  coalesce(t.refunds, 0)::bigint as refunds_cents,
  (coalesce(t.purchases, 0) + coalesce(t.fees, 0) - coalesce(t.refunds, 0))::bigint as total_cents,
  coalesce(t.paid, 0)::bigint as paid_cents,
  (coalesce(t.purchases, 0) + coalesce(t.fees, 0) - coalesce(t.refunds, 0) - coalesce(t.paid, 0))::bigint as outstanding_cents,
  case
    when public.app_today() <= i.cycle_end then 'open'
    when (coalesce(t.purchases, 0) + coalesce(t.fees, 0) - coalesce(t.refunds, 0) - coalesce(t.paid, 0)) <= 0 then 'paid'
    when public.app_today() > i.due_date then 'overdue'
    when coalesce(t.paid, 0) > 0 then 'partially_paid'
    else 'closed'
  end as status
from public.card_invoices i
left join lateral (
  select
    sum(x.amount_cents) filter (where x.type = 'card_purchase' and x.status = 'posted') as purchases,
    sum(x.amount_cents) filter (where x.type = 'card_fee' and x.status = 'posted') as fees,
    sum(x.amount_cents) filter (where x.type = 'card_refund' and x.status = 'posted') as refunds,
    sum(x.amount_cents) filter (where x.type = 'invoice_payment' and x.status = 'posted') as paid
  from public.transactions x
  where x.invoice_id = i.id
) t on true;

-- ------------------------------------------------------------------------------------
-- Categorias padrão
-- ------------------------------------------------------------------------------------
create or replace function public._seed_default_categories(p_household uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_food uuid;
begin
  insert into public.categories (household_id, name, kind, color, sort_order) values
    (p_household, 'Moradia', 'expense', '#8fb8ff', 10),
    (p_household, 'Mercado', 'expense', '#c8f542', 20),
    (p_household, 'Alimentação', 'expense', '#ffb454', 30),
    (p_household, 'Transporte', 'expense', '#7be0c3', 40),
    (p_household, 'Saúde', 'expense', '#ff7a8a', 50),
    (p_household, 'Lazer', 'expense', '#c39bff', 60),
    (p_household, 'Assinaturas', 'expense', '#9aa3ff', 70),
    (p_household, 'Compras', 'expense', '#ffd666', 80),
    (p_household, 'Educação', 'expense', '#6ed3ff', 90),
    (p_household, 'Pets', 'expense', '#e0a97a', 100),
    (p_household, 'Outros', 'expense', '#9a9a92', 110),
    (p_household, 'Salário', 'income', '#c8f542', 10),
    (p_household, 'Renda extra', 'income', '#7be0c3', 20),
    (p_household, 'Transferências', 'transfer', '#9a9a92', 10)
  on conflict do nothing;
  select id into v_food from public.categories where household_id = p_household and kind = 'expense' and name = 'Alimentação';
  insert into public.categories (household_id, name, kind, parent_id, color, sort_order)
    values (p_household, 'iFood / Delivery', 'expense', v_food, '#ff6b6b', 31)
  on conflict do nothing;
end $$;
