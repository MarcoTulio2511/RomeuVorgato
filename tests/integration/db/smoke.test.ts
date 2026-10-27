// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDb } from './harness';

describe('migrations', () => {
  it('aplicam sem erro e criam as tabelas esperadas', { timeout: 120_000 }, async () => {
    const db = await createDb();
    const rows = await db.admin<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'households',
      'household_members',
      'household_invitations',
      'accounts',
      'credit_cards',
      'categories',
      'transactions',
      'card_invoices',
      'installment_plans',
      'installments',
      'budgets',
      'recurring_transactions',
      'planned_transactions',
      'import_batches',
      'import_rows',
      'user_preferences',
      'pierre_messages',
    ]) {
      expect(names).toContain(t);
    }
  });
});

describe('seed de desenvolvimento', () => {
  it('só cria dados [DEV] quando já existe uma casa, e é idempotente', { timeout: 120_000 }, async () => {
    const { readFileSync } = await import('node:fs');
    const db = await createDb();
    const seed = readFileSync('supabase/seed.sql', 'utf8');
    await db.admin(seed); // sem casa: não faz nada
    expect(await db.admin('select 1 from accounts')).toHaveLength(0);
    const u = await db.addUser('dev@teste.dev');
    await db.as(u).rpc('create_household', 'Casa Dev', 'Dev');
    await db.admin(seed);
    await db.admin(seed); // segunda execução ignorada
    const accs = await db.admin<{ name: string }>('select name from accounts');
    expect(accs.map((a) => a.name)).toEqual(['[DEV] Conta corrente']);
    expect(await db.admin('select 1 from transactions')).toHaveLength(2);
  });
});
