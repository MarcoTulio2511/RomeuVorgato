/**
 * Testes de RLS contra um projeto Supabase REAL (local via `supabase start`, ou um projeto de TESTE).
 * NÃO rodam em `npm test`. Use `npm run test:rls` com RLS_SUPABASE_URL, RLS_SUPABASE_ANON_KEY e
 * RLS_SUPABASE_SERVICE_ROLE_KEY (esta última só para criar/remover usuários de teste; nunca vai ao bundle).
 * Sem as variáveis, a suíte é ignorada — e os mesmos cenários rodam localmente em
 * tests/integration/db/security.test.ts (PGlite, com as migrations reais).
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.RLS_SUPABASE_URL;
const anon = process.env.RLS_SUPABASE_ANON_KEY;
const service = process.env.RLS_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anon && service);

describe.skipIf(!enabled)('RLS no Supabase real', () => {
  const password = `Teste-${randomUUID()}`;
  const emails = [`rls-a-${randomUUID()}@example.test`, `rls-b-${randomUUID()}@example.test`];
  const ids: string[] = [];
  let admin: SupabaseClient;
  let a: SupabaseClient;
  let b: SupabaseClient;
  let houseB: string;
  let accountB: string;

  async function login(email: string): Promise<SupabaseClient> {
    const c = createClient(url!, anon!, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return c;
  }

  beforeAll(async () => {
    admin = createClient(url!, service!, { auth: { persistSession: false } });
    for (const email of emails) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      ids.push(data.user.id);
    }
    a = await login(emails[0]!);
    b = await login(emails[1]!);
    await a.rpc('create_household', { p_name: 'Casa A', p_display_name: 'A' });
    houseB = (await b.rpc('create_household', { p_name: 'Casa B', p_display_name: 'B' })).data as string;
    const acc = await b
      .from('accounts')
      .insert({ household_id: houseB, owner_id: ids[1], name: 'Conta B', type: 'checking' })
      .select('id')
      .single();
    accountB = acc.data!.id as string;
  }, 60_000);

  afterAll(async () => {
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  it('A não enxerga nada da casa B', async () => {
    expect((await a.from('accounts').select('id').eq('id', accountB)).data).toEqual([]);
    expect((await a.from('households').select('id').eq('id', houseB)).data).toEqual([]);
    expect((await a.from('transactions').select('id').eq('household_id', houseB)).data).toEqual([]);
  });

  it('A não escreve na casa B', async () => {
    const ins = await a
      .from('accounts')
      .insert({ household_id: houseB, owner_id: ids[0], name: 'x', type: 'checking' });
    expect(ins.error).not.toBeNull();
    const upd = await a.from('accounts').update({ name: 'hack' }).eq('id', accountB).select('id');
    expect(upd.data).toEqual([]);
    const del = await a.from('accounts').delete().eq('id', accountB).select('id');
    expect(del.data).toEqual([]);
    const rpc = await a.rpc('create_transaction', {
      p_household_id: houseB,
      p_request_id: randomUUID(),
      p_type: 'expense',
      p_amount_cents: 100,
      p_occurred_on: '2026-03-01',
      p_description: 'x',
      p_account_id: accountB,
    });
    expect(rpc.error).not.toBeNull();
  });

  it('cliente não altera o próprio papel nem a associação', async () => {
    const r = await a
      .from('household_members')
      .update({ role: 'admin', household_id: houseB })
      .eq('user_id', ids[0]);
    expect(r.error).not.toBeNull();
  });

  it('anon não lê nada', async () => {
    const c = createClient(url!, anon!, { auth: { persistSession: false } });
    const r = await c.from('accounts').select('id');
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
  });
});
