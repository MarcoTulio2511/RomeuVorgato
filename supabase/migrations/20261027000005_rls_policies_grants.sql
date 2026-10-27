-- =====================================================================================
-- Pierre Casa — Row Level Security e permissões (princípio do menor privilégio).
--
-- Modelo:
--  * anon: nenhum acesso.
--  * authenticated: SELECT nas tabelas da própria casa; escrita direta apenas em cadastros simples
--    (contas/cartões próprios, categorias, orçamentos, regras, previstos manuais, preferências);
--    toda operação financeira passa por RPC.
--  * Colunas sensíveis (household_id, owner_id, role, status de previsto…) NÃO são graváveis
--    pelo cliente: GRANTs por coluna.
--  * IMPORTANTE para novas migrations: objetos novos NÃO herdam acesso; conceda explicitamente.
-- =====================================================================================

alter table public.categories enable row level security;
alter table public.accounts enable row level security;
alter table public.credit_cards enable row level security;
alter table public.card_invoices enable row level security;
alter table public.installment_plans enable row level security;
alter table public.installments enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_audit enable row level security;
alter table public.budgets enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.planned_transactions enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.pierre_messages enable row level security;

-- Somente leitura para membros (escrita só por RPC)
create policy card_invoices_select on public.card_invoices for select to authenticated using (public.is_household_member(household_id));
create policy installment_plans_select on public.installment_plans for select to authenticated using (public.is_household_member(household_id));
create policy installments_select on public.installments for select to authenticated using (public.is_household_member(household_id));
create policy transactions_select on public.transactions for select to authenticated using (public.is_household_member(household_id));
create policy transaction_audit_select on public.transaction_audit for select to authenticated using (public.is_household_member(household_id));
create policy import_batches_select on public.import_batches for select to authenticated using (public.is_household_member(household_id));
create policy import_rows_select on public.import_rows for select to authenticated using (public.is_household_member(household_id));

-- Categorias: compartilhadas pela casa
create policy categories_select on public.categories for select to authenticated using (public.is_household_member(household_id));
create policy categories_insert on public.categories for insert to authenticated with check (public.is_household_member(household_id));
create policy categories_update on public.categories for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy categories_delete on public.categories for delete to authenticated using (public.is_household_member(household_id));

-- Contas e cartões: todos da casa VEEM; só o titular cria/edita/exclui os seus
create policy accounts_select on public.accounts for select to authenticated using (public.is_household_member(household_id));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (public.is_household_member(household_id) and owner_id = auth.uid());
create policy accounts_update on public.accounts for update to authenticated
  using (public.is_household_member(household_id) and owner_id = auth.uid())
  with check (public.is_household_member(household_id) and owner_id = auth.uid());
create policy accounts_delete on public.accounts for delete to authenticated
  using (public.is_household_member(household_id) and owner_id = auth.uid());

create policy cards_select on public.credit_cards for select to authenticated using (public.is_household_member(household_id));
create policy cards_insert on public.credit_cards for insert to authenticated
  with check (public.is_household_member(household_id) and owner_id = auth.uid());
create policy cards_update on public.credit_cards for update to authenticated
  using (public.is_household_member(household_id) and owner_id = auth.uid())
  with check (public.is_household_member(household_id) and owner_id = auth.uid());
create policy cards_delete on public.credit_cards for delete to authenticated
  using (public.is_household_member(household_id) and owner_id = auth.uid());

-- Orçamentos: compartilhados (owner null) ou pessoais (owner = eu)
create policy budgets_select on public.budgets for select to authenticated using (public.is_household_member(household_id));
create policy budgets_insert on public.budgets for insert to authenticated
  with check (public.is_household_member(household_id) and (owner_id is null or owner_id = auth.uid()));
create policy budgets_update on public.budgets for update to authenticated
  using (public.is_household_member(household_id) and (owner_id is null or owner_id = auth.uid()))
  with check (public.is_household_member(household_id) and (owner_id is null or owner_id = auth.uid()));
create policy budgets_delete on public.budgets for delete to authenticated
  using (public.is_household_member(household_id) and (owner_id is null or owner_id = auth.uid()));

-- Regras recorrentes e previstos
create policy recurring_select on public.recurring_transactions for select to authenticated using (public.is_household_member(household_id));
create policy recurring_insert on public.recurring_transactions for insert to authenticated
  with check (public.is_household_member(household_id) and owner_id = auth.uid());
create policy recurring_update on public.recurring_transactions for update to authenticated
  using (public.is_household_member(household_id) and owner_id = auth.uid())
  with check (public.is_household_member(household_id) and owner_id = auth.uid());
create policy recurring_delete on public.recurring_transactions for delete to authenticated
  using (public.is_household_member(household_id) and owner_id = auth.uid());

create policy planned_select on public.planned_transactions for select to authenticated using (public.is_household_member(household_id));
create policy planned_insert on public.planned_transactions for insert to authenticated
  with check (public.is_household_member(household_id) and owner_id = auth.uid()
              and status = 'planned' and transaction_id is null and recurring_id is null);
create policy planned_update on public.planned_transactions for update to authenticated
  using (public.is_household_member(household_id) and owner_id = auth.uid() and status = 'planned')
  with check (public.is_household_member(household_id) and owner_id = auth.uid() and status = 'planned');
create policy planned_delete on public.planned_transactions for delete to authenticated
  using (public.is_household_member(household_id) and owner_id = auth.uid() and status = 'planned' and recurring_id is null);

create policy pierre_select on public.pierre_messages for select to authenticated using (user_id = auth.uid());
create policy pierre_insert on public.pierre_messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_member(household_id));
create policy pierre_update on public.pierre_messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy pierre_delete on public.pierre_messages for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------------------------------
-- GRANTs
-- ------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on public.households, public.household_members, public.categories, public.accounts, public.credit_cards,
  public.card_invoices, public.installment_plans, public.installments, public.transactions, public.transaction_audit,
  public.budgets, public.recurring_transactions, public.planned_transactions, public.import_batches, public.import_rows,
  public.pierre_messages, public.user_preferences, public.v_card_invoices to authenticated;
grant select (id, household_id, email, created_by, expires_at, used_at, used_by, revoked_at, created_at)
  on public.household_invitations to authenticated; -- token_hash nunca é exposto

grant update (name, monthly_savings_goal_cents) on public.households to authenticated;
grant update (display_name) on public.household_members to authenticated;

grant insert (user_id, household_id, pierre_enabled, pierre_min_periods, history_variance_pct, default_alert_pct, installment_policy, default_view)
  on public.user_preferences to authenticated;
grant update (pierre_enabled, pierre_min_periods, history_variance_pct, default_alert_pct, installment_policy, default_view)
  on public.user_preferences to authenticated;

grant insert (household_id, name, kind, parent_id, color, icon, sort_order, is_active) on public.categories to authenticated;
grant update (name, parent_id, color, icon, sort_order, is_active) on public.categories to authenticated;
grant delete on public.categories to authenticated;

grant insert (household_id, owner_id, name, institution, type, initial_balance_cents, balance_date, include_in_consolidated, is_active)
  on public.accounts to authenticated;
grant update (name, institution, type, initial_balance_cents, balance_date, include_in_consolidated, is_active)
  on public.accounts to authenticated;
grant delete on public.accounts to authenticated;

grant insert (household_id, owner_id, name, institution, last_four, limit_cents, closing_day, due_day, closing_day_rule, pay_account_id, is_active)
  on public.credit_cards to authenticated;
grant update (name, institution, last_four, limit_cents, closing_day, due_day, closing_day_rule, pay_account_id, is_active)
  on public.credit_cards to authenticated;
grant delete on public.credit_cards to authenticated;

grant insert (household_id, category_id, owner_id, limit_cents, basis, alert_pct, per_order_limit_cents, starts_on, ends_on, is_active)
  on public.budgets to authenticated;
grant update (limit_cents, basis, alert_pct, per_order_limit_cents, starts_on, ends_on, is_active) on public.budgets to authenticated;
grant delete on public.budgets to authenticated;

grant insert (household_id, description, type, amount_cents, frequency, interval_count, start_date, end_date, owner_id, account_id,
  card_id, category_id, scope, is_certain, is_primary_income, is_subscription, weekend_rule, is_active)
  on public.recurring_transactions to authenticated;
grant update (description, amount_cents, frequency, interval_count, start_date, end_date, account_id, card_id, category_id,
  scope, is_certain, is_primary_income, is_subscription, weekend_rule, is_active) on public.recurring_transactions to authenticated;
grant delete on public.recurring_transactions to authenticated;

grant insert (household_id, occurrence_key, due_date, description, type, amount_cents, owner_id, account_id, card_id, category_id,
  scope, is_certain, is_primary_income, is_subscription) on public.planned_transactions to authenticated;
grant update (due_date, description, amount_cents, account_id, card_id, category_id, scope, is_certain)
  on public.planned_transactions to authenticated;
grant delete on public.planned_transactions to authenticated;

grant insert (household_id, user_id, rule_id, dedupe_key, severity, title, body, data) on public.pierre_messages to authenticated;
grant update (severity, title, body, data, last_seen_at, times_shown, dismissed_at, snoozed_until) on public.pierre_messages to authenticated;
grant delete on public.pierre_messages to authenticated;

-- Funções: apenas as RPCs públicas (as internas começam com "_" e não são concedidas)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_household', 'create_invitation', 'revoke_invitation', 'accept_invitation', 'remove_member',
      'create_transaction', 'create_transfer', 'create_installment_purchase', 'cancel_installment_plan', 'pay_invoice',
      'update_transaction', 'cancel_transaction', 'reverse_transaction', 'settle_planned', 'skip_planned',
      'reassign_category', 'materialize_recurring', 'create_import_batch', 'confirm_import', 'cancel_import',
      'revert_import', 'is_household_member', 'is_household_admin', 'app_today')
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
