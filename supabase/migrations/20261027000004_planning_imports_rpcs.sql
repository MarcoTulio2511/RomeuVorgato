-- =====================================================================================
-- Pierre Casa — recorrências (materialização idempotente) e importação atômica.
-- =====================================================================================

-- Data efetiva de uma ocorrência (espelha src/domain/projections/recurrence.ts).
create or replace function public._recurrence_nth(p_freq text, p_interval int, p_start date, k int) returns date
language sql immutable as $$
  select case p_freq
    when 'weekly' then p_start + (7 * p_interval * k)
    when 'biweekly' then p_start + (14 * p_interval * k)
    when 'monthly' then (p_start + make_interval(months => p_interval * k))::date  -- sempre a partir da âncora
    when 'yearly' then (p_start + make_interval(months => 12 * p_interval * k))::date
  end
$$;

create or replace function public._adjust_weekend(d date, p_rule text) returns date
language sql immutable as $$
  select case
    when p_rule = 'none' then d
    when extract(isodow from d) = 6 then d + case when p_rule = 'previous_business_day' then -1 else 2 end
    when extract(isodow from d) = 7 then d + case when p_rule = 'previous_business_day' then -2 else 1 end
    else d end
$$;

-- Gera os previstos (planned_transactions) das regras até p_until. NÃO cria lançamentos reais.
-- Idempotente: a chave `regra:data-teórica` é única por casa → rodar N vezes gera as mesmas linhas.
-- Concorrência: lock advisory por regra. Não há backfill do passado (só ocorrências de hoje em diante).
create or replace function public.materialize_recurring(p_household_id uuid, p_until date, p_rebuild_rule uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.recurring_transactions;
  v_today date := public.app_today();
  v_until date := least(p_until, public.app_today() + 400);
  k int;
  v_sched date;
  v_due date;
  v_created int := 0;
  v_rows int;
begin
  perform public._require_member(p_household_id);
  for r in select * from public.recurring_transactions
           where household_id = p_household_id and is_active order by id loop
    perform pg_advisory_xact_lock(hashtextextended(r.id::text, 7));
    if p_rebuild_rule is not null and r.id = p_rebuild_rule then
      delete from public.planned_transactions where recurring_id = r.id and status = 'planned' and due_date >= v_today;
    end if;
    for k in 0..5000 loop
      v_sched := public._recurrence_nth(r.frequency, r.interval_count, r.start_date, k);
      exit when v_sched > v_until + 3;
      exit when r.end_date is not null and v_sched > r.end_date;
      v_due := public._adjust_weekend(v_sched, r.weekend_rule);
      continue when v_due < v_today or v_due > v_until;
      insert into public.planned_transactions (household_id, recurring_id, occurrence_key, due_date, description, type,
        amount_cents, owner_id, account_id, card_id, category_id, scope, is_certain, is_primary_income, is_subscription)
      values (r.household_id, r.id, r.id::text || ':' || v_sched::text, v_due, r.description, r.type, r.amount_cents,
        r.owner_id, r.account_id, r.card_id, r.category_id, r.scope, r.is_certain, r.is_primary_income, r.is_subscription)
      on conflict (household_id, occurrence_key) do nothing;
      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
    end loop;
    update public.recurring_transactions set next_occurrence_on = (
      select min(due_date) from public.planned_transactions
      where recurring_id = r.id and status = 'planned' and due_date >= v_today) where id = r.id;
  end loop;
  return jsonb_build_object('created', v_created);
end $$;

-- ------------------------------------------------------------------------------------
-- Importação. O ARQUIVO nunca sobe para o servidor: o navegador interpreta CSV/OFX e envia só as linhas
-- normalizadas. Aqui o servidor valida, detecta duplicatas de forma autoritativa e guarda a prévia.
-- ------------------------------------------------------------------------------------
create or replace function public.create_import_batch(
  p_household_id uuid, p_account_id uuid, p_card_id uuid, p_file_name text, p_file_format text,
  p_file_hash text, p_mapping jsonb, p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := public._require_member(p_household_id);
  v_batch uuid;
  v_repeated boolean;
  v_n int;
  r record;
  v_status text;
  v_reason text;
  v_dup uuid;
  v_target uuid := coalesce(p_account_id, p_card_id);
  v_valid int := 0;
  v_invalid int := 0;
  v_dups int := 0;
begin
  if (p_account_id is null) = (p_card_id is null) then
    raise exception 'Escolha uma conta OU um cartão de destino.' using errcode = '22023';
  end if;
  if p_account_id is not null then perform public._assert_own_account(p_household_id, p_account_id);
  else perform public._assert_own_card(p_household_id, p_card_id); end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Linhas inválidas.' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then raise exception 'O arquivo não tem linhas para importar.' using errcode = '22023'; end if;
  if v_n > 5000 then raise exception 'Limite de 5.000 linhas por importação.' using errcode = '22023'; end if;

  -- mesmo arquivo (hash) já confirmado para o mesmo destino?
  select exists (select 1 from public.import_batches b
    where b.household_id = p_household_id and b.file_hash = p_file_hash and b.status = 'confirmed'
      and b.account_id is not distinct from p_account_id and b.card_id is not distinct from p_card_id)
  into v_repeated;

  insert into public.import_batches (household_id, created_by, account_id, card_id, file_name, file_format, file_hash,
    mapping, total_rows, repeated_file)
  values (p_household_id, v_user, p_account_id, p_card_id, left(p_file_name, 255), p_file_format, p_file_hash,
    coalesce(p_mapping, '{}'::jsonb), v_n, v_repeated)
  returning id into v_batch;

  for r in
    select (e.value ->> 'row_number')::int as row_number,
           coalesce(e.value -> 'raw', '{}'::jsonb) as raw,
           nullif(e.value ->> 'occurred_on', '')::date as occurred_on,
           left(nullif(btrim(e.value ->> 'description'), ''), 200) as description,
           (e.value ->> 'amount_cents')::bigint as amount_cents,
           nullif(e.value ->> 'direction', '') as direction,
           left(nullif(btrim(e.value ->> 'external_id'), ''), 120) as external_id,
           left(nullif(e.value ->> 'fingerprint', ''), 160) as fingerprint,
           nullif(e.value ->> 'category_id', '')::uuid as category_id,
           left(nullif(e.value ->> 'reject_reason', ''), 300) as reject_reason
    from jsonb_array_elements(p_rows) as e(value)
    order by 1
  loop
    v_status := 'valid'; v_reason := r.reject_reason; v_dup := null;
    if r.reject_reason is not null or r.occurred_on is null or r.amount_cents is null or r.amount_cents <= 0
       or r.direction is null or r.direction not in ('in', 'out') or r.description is null then
      v_status := 'invalid';
      v_reason := coalesce(v_reason, 'Linha incompleta ou com valor/data inválidos.');
    else
      -- 1) identificador estável da origem (ex.: FITID) → duplicata forte
      if r.external_id is not null then
        select t.id into v_dup from public.transactions t
          where t.household_id = p_household_id and coalesce(t.account_id, t.card_id) = v_target
            and t.source_id = r.external_id and t.status <> 'cancelled' limit 1;
        if v_dup is not null then v_status := 'duplicate'; v_reason := 'Identificador da origem já importado.'; end if;
      end if;
      -- 2) assinatura normalizada de importação anterior → provável duplicata (revisão)
      if v_status = 'valid' and r.fingerprint is not null then
        select t.id into v_dup from public.transactions t
          where t.household_id = p_household_id and coalesce(t.account_id, t.card_id) = v_target
            and t.source_fingerprint = r.fingerprint and t.status <> 'cancelled' limit 1;
        if v_dup is not null then v_status := 'review'; v_reason := 'Linha idêntica a uma já importada (mesma assinatura).'; end if;
      end if;
      -- 3) lançamento manual parecido (mesma data, valor e sentido) → só sinaliza, nunca descarta
      if v_status = 'valid' then
        select t.id into v_dup from public.transactions t
          where t.household_id = p_household_id and coalesce(t.account_id, t.card_id) = v_target
            and t.status <> 'cancelled' and t.occurred_on = r.occurred_on and t.amount_cents = r.amount_cents
            and t.type in (case when r.direction = 'in' then 'income' else 'expense' end,
                           case when r.direction = 'in' then 'card_refund' else 'card_purchase' end) limit 1;
        if v_dup is not null then v_status := 'review'; v_reason := 'Já existe lançamento parecido (mesma data e valor).'; end if;
      end if;
    end if;

    insert into public.import_rows (household_id, batch_id, row_number, raw, occurred_on, description, amount_cents,
      direction, external_id, fingerprint, category_id, status, reject_reason, duplicate_of, include)
    values (p_household_id, v_batch, r.row_number, r.raw, r.occurred_on, r.description, r.amount_cents, r.direction,
      r.external_id, r.fingerprint, r.category_id, v_status, v_reason, v_dup, v_status = 'valid');

    if v_status = 'valid' then v_valid := v_valid + 1;
    elsif v_status = 'invalid' then v_invalid := v_invalid + 1;
    else v_dups := v_dups + 1; end if;
  end loop;

  update public.import_batches set valid_rows = v_valid, invalid_rows = v_invalid, duplicate_rows = v_dups where id = v_batch;
  return jsonb_build_object('batch_id', v_batch, 'repeated_file', v_repeated,
    'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dups);
end $$;

-- Confirma a importação: aplica as decisões do usuário e cria TODOS os lançamentos, ou nenhum.
-- Qualquer erro (ex.: violação do índice de identificador da origem) desfaz o lote inteiro.
create or replace function public.confirm_import(p_batch_id uuid, p_request_id uuid, p_decisions jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.import_batches;
  v_prev jsonb;
  d record;
  r public.import_rows;
  v_type text;
  v_tx uuid;
  v_count int := 0;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found then raise exception 'Importação não encontrada.' using errcode = 'P0002'; end if;
  perform public._require_member(b.household_id);
  v_prev := public._op_begin(b.household_id, p_request_id, 'confirm_import');
  if v_prev is not null then return v_prev; end if;
  if b.created_by <> auth.uid() then raise exception 'Somente quem iniciou a importação pode confirmá-la.' using errcode = '42501'; end if;
  if b.status = 'confirmed' then
    return jsonb_build_object('batch_id', b.id, 'imported', b.imported_rows, 'already_confirmed', true);
  end if;
  if b.status <> 'preview' then raise exception 'Esta importação não está mais em prévia.' using errcode = 'P0001'; end if;
  if b.account_id is not null then perform public._assert_own_account(b.household_id, b.account_id);
  else perform public._assert_own_card(b.household_id, b.card_id); end if;

  for d in select (e.value ->> 'row_id')::uuid as row_id, (e.value ->> 'include')::boolean as include,
                  nullif(e.value ->> 'category_id', '')::uuid as category_id,
                  left(nullif(btrim(e.value ->> 'description'), ''), 200) as description
           from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) as e(value) loop
    update public.import_rows set
      include = case when status = 'invalid' then false else coalesce(d.include, include) end,
      category_id = d.category_id,
      description = coalesce(d.description, description)
    where id = d.row_id and batch_id = b.id;
  end loop;

  for r in select * from public.import_rows where batch_id = b.id and include and status <> 'invalid' order by row_number loop
    if b.account_id is not null then
      v_type := case when r.direction = 'in' then 'income' else 'expense' end;
      v_tx := public._insert_tx(b.household_id, v_type, r.amount_cents, r.occurred_on, r.description, r.category_id,
        auth.uid(), b.account_id, null, 'individual', null, 'posted', 'import', r.external_id, r.fingerprint, b.id);
    else
      v_type := case when r.direction = 'in' then 'card_refund' else 'card_purchase' end;
      v_tx := public._insert_tx(b.household_id, v_type, r.amount_cents, r.occurred_on, r.description, r.category_id,
        auth.uid(), null, b.card_id, 'individual', null, 'posted', 'import', r.external_id, r.fingerprint, b.id);
    end if;
    update public.import_rows set transaction_id = v_tx where id = r.id;
    v_count := v_count + 1;
  end loop;

  update public.import_batches set status = 'confirmed', imported_rows = v_count, confirmed_at = now() where id = b.id;
  return public._op_end(b.household_id, p_request_id, 'confirm_import', jsonb_build_object('batch_id', b.id, 'imported', v_count));
end $$;

create or replace function public.cancel_import(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.import_batches;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found then raise exception 'Importação não encontrada.' using errcode = 'P0002'; end if;
  perform public._require_member(b.household_id);
  if b.created_by <> auth.uid() or b.status <> 'preview' then
    raise exception 'Só é possível cancelar uma prévia sua.' using errcode = 'P0001';
  end if;
  update public.import_batches set status = 'cancelled' where id = b.id;
end $$;

-- Desfaz uma importação confirmada: cancela (logicamente) os lançamentos criados por ela.
create or replace function public.revert_import(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.import_batches;
  n int;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found then raise exception 'Importação não encontrada.' using errcode = 'P0002'; end if;
  perform public._require_member(b.household_id);
  if b.created_by <> auth.uid() or b.status <> 'confirmed' then
    raise exception 'Só é possível desfazer uma importação sua já confirmada.' using errcode = 'P0001';
  end if;
  update public.transactions set status = 'cancelled' where import_batch_id = b.id and status <> 'cancelled';
  get diagnostics n = row_count;
  update public.import_batches set status = 'reverted' where id = b.id;
  return jsonb_build_object('cancelled', n);
end $$;
