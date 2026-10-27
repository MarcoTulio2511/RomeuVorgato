-- =====================================================================================
-- Pierre Casa — operações financeiras ATÔMICAS (RPCs).
-- Cada função roda em UMA transação, valida auth.uid()/associação à casa no servidor e é idempotente
-- quando recebe p_request_id (uuid gerado pelo cliente uma vez por tentativa de formulário).
-- O cliente não possui INSERT/UPDATE/DELETE em `transactions`: toda escrita passa por aqui.
-- =====================================================================================

create or replace function public._assert_own_account(p_household uuid, p_account uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_account and household_id = p_household;
  if not found then raise exception 'Conta não encontrada.' using errcode = 'P0002'; end if;
  if a.owner_id <> auth.uid() then
    raise exception 'Você só pode lançar em contas que são suas.' using errcode = '42501';
  end if;
  if not a.is_active then raise exception 'A conta está inativa.' using errcode = 'P0001'; end if;
end $$;

create or replace function public._assert_own_card(p_household uuid, p_card uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.credit_cards;
begin
  select * into c from public.credit_cards where id = p_card and household_id = p_household;
  if not found then raise exception 'Cartão não encontrado.' using errcode = 'P0002'; end if;
  if c.owner_id <> auth.uid() then
    raise exception 'Você só pode lançar em cartões que são seus.' using errcode = '42501';
  end if;
  if not c.is_active then raise exception 'O cartão está inativo.' using errcode = 'P0001'; end if;
end $$;

create or replace function public._check_date(p_date date) returns void
language plpgsql stable as $$
begin
  if p_date is null or p_date < date '2000-01-01' or p_date > public.app_today() + 3660 then
    raise exception 'Data inválida.' using errcode = '22007';
  end if;
end $$;

create or replace function public._insert_tx(
  p_household uuid, p_type text, p_amount bigint, p_date date, p_desc text, p_category uuid,
  p_owner uuid, p_account uuid, p_card uuid, p_scope text, p_notes text, p_status text,
  p_source text default 'manual', p_source_id text default null, p_fingerprint text default null,
  p_batch uuid default null, p_group uuid default null, p_plan uuid default null, p_number int default null,
  p_invoice uuid default null, p_reversal uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_invoice uuid := p_invoice;
begin
  if p_type in ('card_purchase', 'card_refund', 'card_fee') and v_invoice is null then
    v_invoice := public._ensure_invoice(p_card, p_date); -- compra → obrigação na fatura do ciclo correto
  end if;
  insert into public.transactions (
    household_id, type, amount_cents, occurred_on, description, category_id, owner_id, created_by,
    account_id, card_id, scope, status, notes, source, source_id, source_fingerprint, import_batch_id,
    transfer_group_id, invoice_id, installment_plan_id, installment_number, reversal_of_id)
  values (
    p_household, p_type, p_amount, p_date, btrim(p_desc), p_category, p_owner, auth.uid(),
    p_account, p_card, coalesce(p_scope, 'individual'), coalesce(p_status, 'posted'), nullif(btrim(p_notes), ''), p_source,
    p_source_id, p_fingerprint, p_batch, p_group, v_invoice, p_plan, p_number, p_reversal)
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------------------------------
-- Lançamento simples (receita, despesa, estorno, ajuste, compra/estorno/encargo de cartão)
-- ------------------------------------------------------------------------------------
create or replace function public.create_transaction(
  p_household_id uuid, p_request_id uuid, p_type text, p_amount_cents bigint, p_occurred_on date,
  p_description text, p_category_id uuid default null, p_account_id uuid default null, p_card_id uuid default null,
  p_scope text default 'individual', p_notes text default null, p_status text default 'posted'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := public._require_member(p_household_id);
  v_prev jsonb := public._op_begin(p_household_id, p_request_id, 'create_transaction');
  v_id uuid;
begin
  if v_prev is not null then return v_prev; end if;
  if p_type not in ('income', 'expense', 'refund', 'adjustment_in', 'adjustment_out', 'card_purchase', 'card_refund', 'card_fee') then
    raise exception 'Tipo de lançamento inválido para esta operação.' using errcode = '22023';
  end if;
  perform public._check_date(p_occurred_on);
  if p_type in ('card_purchase', 'card_refund', 'card_fee') then
    if p_card_id is null or p_account_id is not null then
      raise exception 'Informe o cartão (e não a conta) para este tipo.' using errcode = '22023';
    end if;
    perform public._assert_own_card(p_household_id, p_card_id);
  else
    if p_account_id is null or p_card_id is not null then
      raise exception 'Informe a conta (e não o cartão) para este tipo.' using errcode = '22023';
    end if;
    perform public._assert_own_account(p_household_id, p_account_id);
  end if;
  if p_status = 'pending' and p_type <> 'card_purchase' then
    raise exception 'Somente compras no cartão podem ficar pendentes.' using errcode = '22023';
  end if;
  v_id := public._insert_tx(p_household_id, p_type, p_amount_cents, p_occurred_on, p_description, p_category_id,
    v_user, p_account_id, p_card_id, p_scope, p_notes, p_status);
  return public._op_end(p_household_id, p_request_id, 'create_transaction', jsonb_build_object('id', v_id));
end $$;

-- ------------------------------------------------------------------------------------
-- Transferência entre contas (duas pernas ligadas por transfer_group_id; nunca receita/despesa)
-- ------------------------------------------------------------------------------------
create or replace function public.create_transfer(
  p_household_id uuid, p_request_id uuid, p_from_account uuid, p_to_account uuid, p_amount_cents bigint,
  p_occurred_on date, p_description text default 'Transferência'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := public._require_member(p_household_id);
  v_prev jsonb := public._op_begin(p_household_id, p_request_id, 'create_transfer');
  v_group uuid := gen_random_uuid();
  v_to public.accounts;
  v_out uuid;
  v_in uuid;
begin
  if v_prev is not null then return v_prev; end if;
  if p_from_account = p_to_account then
    raise exception 'Origem e destino devem ser contas diferentes.' using errcode = '22023';
  end if;
  perform public._check_date(p_occurred_on);
  perform public._assert_own_account(p_household_id, p_from_account);
  select * into v_to from public.accounts where id = p_to_account and household_id = p_household_id;
  if not found or not v_to.is_active then
    raise exception 'Conta de destino não encontrada ou inativa.' using errcode = 'P0002';
  end if;
  v_out := public._insert_tx(p_household_id, 'transfer_out', p_amount_cents, p_occurred_on, p_description, null,
    v_user, p_from_account, null, 'individual', null, 'posted', 'manual', null, null, null, v_group);
  v_in := public._insert_tx(p_household_id, 'transfer_in', p_amount_cents, p_occurred_on, p_description, null,
    v_to.owner_id, p_to_account, null, 'individual', null, 'posted', 'manual', null, null, null, v_group);
  return public._op_end(p_household_id, p_request_id, 'create_transfer',
    jsonb_build_object('transfer_group_id', v_group, 'out_id', v_out, 'in_id', v_in));
end $$;

-- ------------------------------------------------------------------------------------
-- Compra parcelada: plano + cronograma + N lançamentos de cartão, tudo ou nada.
-- Regra de centavos (idêntica ao domínio TS): parcela k = floor(total/n) + (k <= total mod n ? 1 : 0).
-- ------------------------------------------------------------------------------------
create or replace function public.create_installment_purchase(
  p_household_id uuid, p_request_id uuid, p_card_id uuid, p_description text, p_total_cents bigint,
  p_installments int, p_purchase_date date, p_category_id uuid default null, p_scope text default 'individual',
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := public._require_member(p_household_id);
  v_prev jsonb := public._op_begin(p_household_id, p_request_id, 'create_installment_purchase');
  c public.credit_cards;
  v_plan uuid;
  v_base bigint;
  v_rest bigint;
  v_amount bigint;
  v_first_closing date;
  v_closing date;
  v_inv uuid;
  v_due date;
  v_comp date;
  v_tx uuid;
  k int;
begin
  if v_prev is not null then return v_prev; end if;
  if p_installments < 1 or p_installments > 48 then
    raise exception 'Número de parcelas deve estar entre 1 e 48.' using errcode = '22023';
  end if;
  if p_total_cents < p_installments then
    raise exception 'Valor insuficiente para essa quantidade de parcelas.' using errcode = '22023';
  end if;
  perform public._check_date(p_purchase_date);
  perform public._assert_own_card(p_household_id, p_card_id);
  select * into c from public.credit_cards where id = p_card_id;

  insert into public.installment_plans (household_id, description, total_cents, installment_count, purchase_date,
    card_id, category_id, owner_id, scope, created_by)
  values (p_household_id, btrim(p_description), p_total_cents, p_installments, p_purchase_date,
    p_card_id, p_category_id, v_user, coalesce(p_scope, 'individual'), v_user)
  returning id into v_plan;

  v_base := p_total_cents / p_installments;
  v_rest := p_total_cents - v_base * p_installments;
  v_first_closing := public._card_closing_for(c.closing_day, c.closing_day_rule, p_purchase_date);

  for k in 1..p_installments loop
    v_amount := v_base + case when k <= v_rest then 1 else 0 end;
    v_closing := public._clamp_day(public._add_months(public._month_start(v_first_closing), k - 1), c.closing_day);
    v_inv := public._ensure_invoice_by_closing(p_card_id, v_closing);
    select due_date into v_due from public.card_invoices where id = v_inv;
    v_comp := public._add_months(p_purchase_date, k - 1);
    v_tx := public._insert_tx(p_household_id, 'card_purchase', v_amount, v_comp,
      btrim(p_description) || ' (' || k || '/' || p_installments || ')', p_category_id, v_user, null, p_card_id,
      p_scope, p_notes, 'posted', 'manual', null, null, null, null, v_plan, k, v_inv);
    insert into public.installments (household_id, plan_id, number, amount_cents, competence_date, due_date, invoice_id, transaction_id)
    values (p_household_id, v_plan, k, v_amount, v_comp, v_due, v_inv, v_tx);
  end loop;

  return public._op_end(p_household_id, p_request_id, 'create_installment_purchase',
    jsonb_build_object('plan_id', v_plan));
end $$;

create or replace function public.cancel_installment_plan(p_plan_id uuid, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p public.installment_plans;
  v_prev jsonb;
begin
  select * into p from public.installment_plans where id = p_plan_id for update;
  if not found then raise exception 'Parcelamento não encontrado.' using errcode = 'P0002'; end if;
  perform public._require_member(p.household_id);
  v_prev := public._op_begin(p.household_id, p_request_id, 'cancel_installment_plan');
  if v_prev is not null then return v_prev; end if;
  if p.created_by <> auth.uid() and p.owner_id <> auth.uid() then
    raise exception 'Somente quem lançou pode cancelar o parcelamento.' using errcode = '42501';
  end if;
  if p.status = 'cancelled' then
    return public._op_end(p.household_id, p_request_id, 'cancel_installment_plan', jsonb_build_object('plan_id', p.id));
  end if;
  if exists (
    select 1 from public.transactions pay
    where pay.type = 'invoice_payment' and pay.status = 'posted'
      and pay.invoice_id in (select invoice_id from public.transactions where installment_plan_id = p.id)
  ) then
    raise exception 'Há parcelas em faturas que já receberam pagamento. Use estorno em vez de cancelar.' using errcode = 'P0001';
  end if;
  update public.transactions set status = 'cancelled' where installment_plan_id = p.id and status <> 'cancelled';
  update public.installment_plans set status = 'cancelled' where id = p.id;
  return public._op_end(p.household_id, p_request_id, 'cancel_installment_plan', jsonb_build_object('plan_id', p.id));
end $$;

-- ------------------------------------------------------------------------------------
-- Pagamento de fatura: debita a conta E abate a fatura na mesma transação. Não gera nova despesa.
-- A linha da fatura é bloqueada para que dois pagamentos simultâneos não ultrapassem o saldo.
-- ------------------------------------------------------------------------------------
create or replace function public.pay_invoice(
  p_invoice_id uuid, p_request_id uuid, p_account_id uuid, p_amount_cents bigint, p_occurred_on date
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv public.card_invoices;
  c public.credit_cards;
  v_prev jsonb;
  v_total bigint;
  v_paid bigint;
  v_id uuid;
begin
  select * into inv from public.card_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Fatura não encontrada.' using errcode = 'P0002'; end if;
  perform public._require_member(inv.household_id);
  v_prev := public._op_begin(inv.household_id, p_request_id, 'pay_invoice');
  if v_prev is not null then return v_prev; end if;
  perform public._check_date(p_occurred_on);
  perform public._assert_own_account(inv.household_id, p_account_id);
  select * into c from public.credit_cards where id = inv.card_id;

  select coalesce(sum(amount_cents) filter (where type in ('card_purchase', 'card_fee')), 0)
         - coalesce(sum(amount_cents) filter (where type = 'card_refund'), 0),
         coalesce(sum(amount_cents) filter (where type = 'invoice_payment'), 0)
    into v_total, v_paid
    from public.transactions where invoice_id = inv.id and status = 'posted';
  if v_total - v_paid <= 0 then
    raise exception 'Esta fatura não tem saldo a pagar.' using errcode = 'P0001';
  end if;
  if p_amount_cents > v_total - v_paid then
    raise exception 'O valor excede o saldo em aberto da fatura.' using errcode = 'P0001';
  end if;

  v_id := public._insert_tx(inv.household_id, 'invoice_payment', p_amount_cents, p_occurred_on,
    'Pagamento da fatura ' || c.name, null, auth.uid(), p_account_id, inv.card_id, 'individual', null, 'posted',
    'manual', null, null, null, null, null, null, inv.id);
  return public._op_end(inv.household_id, p_request_id, 'pay_invoice',
    jsonb_build_object('id', v_id, 'remaining_cents', v_total - v_paid - p_amount_cents));
end $$;

-- ------------------------------------------------------------------------------------
-- Edição e cancelamento (exclusão LÓGICA, com auditoria via trigger)
-- ------------------------------------------------------------------------------------
create or replace function public.update_transaction(
  p_tx_id uuid, p_description text default null, p_category_id uuid default null, p_clear_category boolean default false,
  p_notes text default null, p_scope text default null, p_occurred_on date default null,
  p_amount_cents bigint default null, p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.transactions;
  v_invoice uuid;
begin
  select * into t from public.transactions where id = p_tx_id for update;
  if not found then raise exception 'Lançamento não encontrado.' using errcode = 'P0002'; end if;
  perform public._require_member(t.household_id);
  if t.created_by <> auth.uid() and t.owner_id <> auth.uid() then
    raise exception 'Você só pode editar lançamentos seus.' using errcode = '42501';
  end if;
  if t.status = 'cancelled' then raise exception 'Lançamento cancelado não pode ser editado.' using errcode = 'P0001'; end if;
  if p_occurred_on is not null then perform public._check_date(p_occurred_on); end if;

  if t.type = 'invoice_payment' and (p_amount_cents is not null or p_account_id is not null) then
    raise exception 'Para alterar valor ou conta de um pagamento de fatura, cancele e lance novamente.' using errcode = 'P0001';
  end if;
  if t.installment_plan_id is not null and (p_amount_cents is not null or p_occurred_on is not null) then
    raise exception 'Valor e data de parcelas não podem ser editados; cancele o parcelamento e refaça.' using errcode = 'P0001';
  end if;
  if t.type in ('transfer_in', 'transfer_out') and (p_account_id is not null or p_category_id is not null) then
    raise exception 'Transferências só permitem alterar valor, data e descrição.' using errcode = 'P0001';
  end if;

  if t.type in ('transfer_in', 'transfer_out') then
    update public.transactions set
      description = coalesce(btrim(p_description), description),
      amount_cents = coalesce(p_amount_cents, amount_cents),
      occurred_on = coalesce(p_occurred_on, occurred_on),
      notes = coalesce(nullif(btrim(p_notes), ''), notes)
    where transfer_group_id = t.transfer_group_id and status <> 'cancelled';
    return jsonb_build_object('id', t.id);
  end if;

  if p_account_id is not null then
    if t.account_id is null or t.type = 'invoice_payment' then
      raise exception 'Este lançamento não está vinculado a uma conta.' using errcode = 'P0001';
    end if;
    perform public._assert_own_account(t.household_id, p_account_id);
  end if;
  v_invoice := t.invoice_id;
  if p_occurred_on is not null and t.type in ('card_purchase', 'card_refund', 'card_fee') then
    v_invoice := public._ensure_invoice(t.card_id, p_occurred_on); -- mudou a data → pode mudar de fatura
  end if;

  update public.transactions set
    description = coalesce(btrim(p_description), description),
    category_id = case when p_clear_category then null else coalesce(p_category_id, category_id) end,
    notes = coalesce(nullif(btrim(p_notes), ''), notes),
    scope = coalesce(p_scope, scope),
    occurred_on = coalesce(p_occurred_on, occurred_on),
    amount_cents = coalesce(p_amount_cents, amount_cents),
    account_id = coalesce(p_account_id, account_id),
    invoice_id = v_invoice
  where id = t.id;
  return jsonb_build_object('id', t.id);
end $$;

create or replace function public.cancel_transaction(p_tx_id uuid, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.transactions;
  v_ids uuid[];
  v_prev jsonb;
begin
  select * into t from public.transactions where id = p_tx_id for update;
  if not found then raise exception 'Lançamento não encontrado.' using errcode = 'P0002'; end if;
  perform public._require_member(t.household_id);
  v_prev := public._op_begin(t.household_id, p_request_id, 'cancel_transaction');
  if v_prev is not null then return v_prev; end if;
  if t.created_by <> auth.uid() and t.owner_id <> auth.uid() then
    raise exception 'Você só pode cancelar lançamentos seus.' using errcode = '42501';
  end if;
  if t.installment_plan_id is not null then
    raise exception 'Parcelas são canceladas pelo parcelamento inteiro.' using errcode = 'P0001';
  end if;
  if t.status <> 'cancelled' then
    select array_agg(id) into v_ids from public.transactions
      where (id = t.id or (t.transfer_group_id is not null and transfer_group_id = t.transfer_group_id)) and status <> 'cancelled';
    update public.transactions set status = 'cancelled' where id = any(v_ids);
    -- se veio de um previsto, ele volta a ser "previsto" (não conta duas vezes nem some do planejamento)
    update public.planned_transactions set status = 'planned', transaction_id = null where transaction_id = any(v_ids);
  end if;
  return public._op_end(t.household_id, p_request_id, 'cancel_transaction', jsonb_build_object('id', t.id));
end $$;

-- Estorno: cria o lançamento inverso, ligado ao original; o original permanece (trilha de auditoria).
create or replace function public.reverse_transaction(p_tx_id uuid, p_request_id uuid, p_occurred_on date default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.transactions;
  v_prev jsonb;
  v_type text;
  v_date date := coalesce(p_occurred_on, public.app_today());
  v_id uuid;
begin
  select * into t from public.transactions where id = p_tx_id for update;
  if not found then raise exception 'Lançamento não encontrado.' using errcode = 'P0002'; end if;
  perform public._require_member(t.household_id);
  v_prev := public._op_begin(t.household_id, p_request_id, 'reverse_transaction');
  if v_prev is not null then return v_prev; end if;
  if t.created_by <> auth.uid() and t.owner_id <> auth.uid() then
    raise exception 'Você só pode estornar lançamentos seus.' using errcode = '42501';
  end if;
  if t.status <> 'posted' then raise exception 'Somente lançamentos efetivados podem ser estornados.' using errcode = 'P0001'; end if;
  if t.type = 'expense' then v_type := 'refund';
  elsif t.type in ('card_purchase', 'card_fee') then v_type := 'card_refund';
  else raise exception 'Este tipo de lançamento não pode ser estornado (cancele-o).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions where reversal_of_id = t.id and status <> 'cancelled') then
    raise exception 'Este lançamento já foi estornado.' using errcode = 'P0001';
  end if;
  perform public._check_date(v_date);
  v_id := public._insert_tx(t.household_id, v_type, t.amount_cents, v_date, 'Estorno: ' || t.description, t.category_id,
    t.owner_id, case when v_type = 'refund' then t.account_id end, case when v_type = 'card_refund' then t.card_id end,
    t.scope, null, 'posted', 'manual', null, null, null, null, null, null, null, t.id);
  return public._op_end(t.household_id, p_request_id, 'reverse_transaction', jsonb_build_object('id', v_id));
end $$;

-- ------------------------------------------------------------------------------------
-- Previstos: efetivar / ignorar. Efetivar cria o lançamento real e fecha o previsto na mesma transação.
-- ------------------------------------------------------------------------------------
create or replace function public.settle_planned(
  p_planned_id uuid, p_request_id uuid, p_account_id uuid default null, p_card_id uuid default null,
  p_amount_cents bigint default null, p_occurred_on date default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pl public.planned_transactions;
  v_prev jsonb;
  v_account uuid;
  v_card uuid;
  v_type text;
  v_date date := coalesce(p_occurred_on, public.app_today());
  v_id uuid;
begin
  select * into pl from public.planned_transactions where id = p_planned_id for update;
  if not found then raise exception 'Previsão não encontrada.' using errcode = 'P0002'; end if;
  perform public._require_member(pl.household_id);
  v_prev := public._op_begin(pl.household_id, p_request_id, 'settle_planned');
  if v_prev is not null then return v_prev; end if;
  if pl.status <> 'planned' then raise exception 'Esta previsão já foi efetivada ou ignorada.' using errcode = 'P0001'; end if;
  perform public._check_date(v_date);
  v_account := coalesce(p_account_id, pl.account_id);
  v_card := coalesce(p_card_id, pl.card_id);
  if pl.type = 'income' then
    v_type := 'income'; v_card := null;
  elsif v_card is not null and p_account_id is null then
    v_type := 'card_purchase'; v_account := null;
  else
    v_type := 'expense'; v_card := null;
  end if;
  if v_account is not null then perform public._assert_own_account(pl.household_id, v_account); end if;
  if v_card is not null then perform public._assert_own_card(pl.household_id, v_card); end if;
  v_id := public._insert_tx(pl.household_id, v_type, coalesce(p_amount_cents, pl.amount_cents), v_date, pl.description,
    pl.category_id, auth.uid(), v_account, v_card, pl.scope, null, 'posted', 'recurring');
  update public.planned_transactions set status = 'realized', transaction_id = v_id where id = pl.id;
  return public._op_end(pl.household_id, p_request_id, 'settle_planned', jsonb_build_object('id', v_id));
end $$;

create or replace function public.skip_planned(p_planned_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl public.planned_transactions;
begin
  select * into pl from public.planned_transactions where id = p_planned_id for update;
  if not found then raise exception 'Previsão não encontrada.' using errcode = 'P0002'; end if;
  perform public._require_member(pl.household_id);
  if pl.status <> 'planned' then raise exception 'Esta previsão não está mais pendente.' using errcode = 'P0001'; end if;
  update public.planned_transactions set status = 'skipped' where id = pl.id;
end $$;

-- Reclassificação: move tudo de uma categoria para outra (alternativa à exclusão destrutiva).
create or replace function public.reassign_category(p_from uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a public.categories;
  b public.categories;
  n_tx int;
begin
  select * into a from public.categories where id = p_from;
  select * into b from public.categories where id = p_to;
  if a.id is null or b.id is null or a.household_id <> b.household_id then
    raise exception 'Categoria não encontrada.' using errcode = 'P0002';
  end if;
  perform public._require_member(a.household_id);
  if a.kind <> b.kind then raise exception 'As categorias precisam ser do mesmo tipo.' using errcode = 'P0001'; end if;
  update public.transactions set category_id = p_to where category_id = p_from;
  get diagnostics n_tx = row_count;
  update public.installment_plans set category_id = p_to where category_id = p_from;
  update public.recurring_transactions set category_id = p_to where category_id = p_from;
  update public.planned_transactions set category_id = p_to where category_id = p_from;
  update public.import_rows set category_id = p_to where category_id = p_from;
  update public.categories set parent_id = p_to where parent_id = p_from and id <> p_to;
  -- orçamento: se já existe um para o destino, o da origem é desativado
  update public.budgets set is_active = false
    where category_id = p_from
      and exists (select 1 from public.budgets x where x.category_id = p_to and x.is_active
                  and x.household_id = budgets.household_id and x.owner_id is not distinct from budgets.owner_id);
  update public.budgets set category_id = p_to where category_id = p_from and is_active;
  update public.categories set is_active = false where id = p_from;
  return jsonb_build_object('moved_transactions', n_tx);
end $$;
