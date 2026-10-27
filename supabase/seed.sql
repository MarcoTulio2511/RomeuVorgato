-- =====================================================================================
-- SEED DE DESENVOLVIMENTO — NÃO USE EM PRODUÇÃO.
-- Cria dados de exemplo na primeira casa encontrada, marcando tudo com o prefixo "[DEV]" para nunca
-- ser confundido com dados reais. Só roda se (1) já existir uma casa e (2) ainda não houver conta "[DEV]".
-- Fluxo: crie 2 usuários e a casa pela interface; depois rode este arquivo no SQL Editor (ou `supabase db reset`).
-- Os valores abaixo são apenas exemplos editáveis; nenhum é imposto ao usuário.
-- =====================================================================================
do $$
declare
  v_house uuid;
  v_user uuid;
  v_account uuid;
  v_card uuid;
  v_cat uuid;
begin
  select h.id, m.user_id into v_house, v_user
  from public.households h join public.household_members m on m.household_id = h.id and m.is_active
  order by h.created_at limit 1;

  if v_house is null then
    raise notice 'Seed ignorado: crie uma casa pela interface primeiro.';
    return;
  end if;
  if exists (select 1 from public.accounts where household_id = v_house and name like '[DEV]%') then
    raise notice 'Seed ignorado: dados [DEV] já existem.';
    return;
  end if;

  insert into public.accounts (household_id, owner_id, name, type, initial_balance_cents, balance_date)
    values (v_house, v_user, '[DEV] Conta corrente', 'checking', 250000, date_trunc('month', current_date)::date - 60)
    returning id into v_account;
  insert into public.credit_cards (household_id, owner_id, name, limit_cents, closing_day, due_day, pay_account_id)
    values (v_house, v_user, '[DEV] Cartão', 500000, 25, 5, v_account) returning id into v_card;
  select id into v_cat from public.categories where household_id = v_house and name = 'Mercado' and kind = 'expense' limit 1;

  insert into public.transactions (household_id, type, amount_cents, occurred_on, description, owner_id, created_by, account_id, category_id)
    values (v_house, 'income', 450000, date_trunc('month', current_date)::date + 4, '[DEV] Salário', v_user, v_user, v_account, null),
           (v_house, 'expense', 38990, date_trunc('month', current_date)::date + 2, '[DEV] Mercado', v_user, v_user, v_account, v_cat);

  raise notice 'Seed [DEV] criado na casa %', v_house;
end $$;
