// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './harness';

/**
 * Testes NEGATIVOS de autorização: um usuário não consulta, altera nem apaga dados de outra casa,
 * não escolhe o próprio papel, e convites seguem as regras (hash, expiração, uso único, limite de membros).
 */
let db: Db;
let ana: string, bru: string, eve: string, carl: string;
let houseA: string, houseE: string;
let accAna: string, accEve: string;

beforeAll(async () => {
  db = await createDb();
  [ana, bru, eve, carl] = (await Promise.all(
    ['ana', 'bru', 'eve', 'carl'].map((n) => db.addUser(`${n}@teste.dev`)),
  )) as [string, string, string, string];
  houseA = await db.as(ana).rpc<string>('create_household', 'Casa da Ana', 'Ana');
  houseE = await db.as(eve).rpc<string>('create_household', 'Casa da Eve', 'Eve');
  const inv = await db.as(ana).rpc<{ token: string }>('create_invitation', houseA, null, 168);
  await db.as(bru).rpc('accept_invitation', inv.token, 'Bru');
  [accAna] = (
    await db.as(ana).query<{ id: string }>(
      `insert into accounts (household_id, owner_id, name, type, initial_balance_cents, balance_date)
     values ($1, $2, 'Conta Ana', 'checking', 100000, '2026-01-01') returning id`,
      [houseA, ana],
    )
  ).map((r) => r.id) as [string];
  [accEve] = (
    await db.as(eve).query<{ id: string }>(
      `insert into accounts (household_id, owner_id, name, type, initial_balance_cents, balance_date)
     values ($1, $2, 'Conta Eve', 'checking', 555000, '2026-01-01') returning id`,
      [houseE, eve],
    )
  ).map((r) => r.id) as [string];
}, 120_000);

describe('isolamento entre casas (RLS)', () => {
  it('dois usuários acessam a mesma casa, e cada um vê a conta do outro', async () => {
    expect(await db.as(bru).query('select id from accounts where id = $1', [accAna])).toHaveLength(1);
    expect(
      await db.as(ana).query('select user_id from household_members where household_id = $1', [houseA]),
    ).toHaveLength(2);
  });

  it('não consulta dados de outra casa', async () => {
    for (const table of [
      'accounts',
      'households',
      'household_members',
      'categories',
      'transactions',
      'budgets',
    ]) {
      const col = table === 'households' ? 'id' : 'household_id';
      expect(
        await db.as(ana).query(`select 1 from ${table} where ${col} = $1`, [houseE]),
        table,
      ).toHaveLength(0);
    }
    expect(await db.as(ana).query('select id from accounts where id = $1', [accEve])).toHaveLength(0);
  });

  it('anônimo não lê nada', async () => {
    expect(await db.as(null).fails('select * from accounts')).toMatch(/permission denied/i);
  });

  it('não insere registros em outra casa nem em nome de outra pessoa', async () => {
    expect(
      await db
        .as(ana)
        .fails(
          `insert into accounts (household_id, owner_id, name, type) values ($1, $2, 'invasão', 'checking')`,
          [houseE, ana],
        ),
    ).toMatch(/row-level security/i);
    // dentro da própria casa, mas em nome do parceiro
    expect(
      await db
        .as(bru)
        .fails(
          `insert into accounts (household_id, owner_id, name, type) values ($1, $2, 'em nome da ana', 'checking')`,
          [houseA, ana],
        ),
    ).toMatch(/row-level security/i);
    expect(
      await db
        .as(ana)
        .fails(`insert into categories (household_id, name, kind) values ($1, 'x', 'expense')`, [houseE]),
    ).toMatch(/row-level security/i);
  });

  it('não altera nem apaga registros de outra casa (0 linhas afetadas)', async () => {
    expect(
      await db.as(ana).query('update accounts set name = $2 where id = $1 returning id', [accEve, 'hack']),
    ).toHaveLength(0);
    expect(await db.as(ana).query('delete from accounts where id = $1 returning id', [accEve])).toHaveLength(
      0,
    );
    expect(
      await db.as(ana).query('update households set name = $2 where id = $1 returning id', [houseE, 'hack']),
    ).toHaveLength(0);
    const [row] = await db.admin<{ name: string }>('select name from accounts where id = $1', [accEve]);
    expect(row?.name).toBe('Conta Eve');
  });

  it('parceiro não edita nem apaga a conta do outro (mesma casa)', async () => {
    expect(
      await db.as(bru).query('update accounts set name = $2 where id = $1 returning id', [accAna, 'x']),
    ).toHaveLength(0);
    expect(await db.as(bru).query('delete from accounts where id = $1 returning id', [accAna])).toHaveLength(
      0,
    );
  });

  it('RPCs recusam casa alheia', async () => {
    const msg = await db
      .as(ana)
      .rpcFails('create_transaction', houseE, randomUUID(), 'expense', 100, '2026-03-01', 'x', null, accEve);
    expect(msg).toMatch(/não tem acesso/i);
    expect(
      await db
        .as(ana)
        .rpcFails('create_transfer', houseE, randomUUID(), accEve, accEve, 100, '2026-03-01', 'x'),
    ).toMatch(/acesso/i);
    expect(await db.as(ana).rpcFails('create_invitation', houseE, null, 24)).toMatch(/administradores/i);
  });

  it('lançamento em conta que é do parceiro é recusado', async () => {
    const msg = await db
      .as(bru)
      .rpcFails('create_transaction', houseA, randomUUID(), 'expense', 100, '2026-03-01', 'x', null, accAna);
    expect(msg).toMatch(/suas/i);
  });

  it('cliente não escreve direto em transações nem em tabelas internas', async () => {
    const msg = await db.as(ana).fails(
      `insert into transactions (household_id, type, amount_cents, occurred_on, description, owner_id, created_by, account_id)
       values ($1, 'income', 1, '2026-03-01', 'x', $2, $2, $3)`,
      [houseA, ana, accAna],
    );
    expect(msg).toMatch(/permission denied/i);
    expect(await db.as(ana).fails('select * from operation_requests')).toMatch(/permission denied/i);
    expect(await db.as(ana).fails('update transactions set amount_cents = 1')).toMatch(/permission denied/i);
    expect(await db.as(ana).fails('delete from transactions')).toMatch(/permission denied/i);
  });

  it('funções internas não são executáveis pelo cliente', async () => {
    expect(await db.as(ana).fails('select public._insert_tx($1, $2)', [houseA, 'x'])).toMatch(
      /permission denied|does not exist/i,
    );
    expect(
      await db.as(ana).fails('select public._ensure_invoice($1, $2)', [randomUUID(), '2026-03-01']),
    ).toMatch(/permission denied/i);
  });

  it('FKs compostas impedem referência entre casas, mesmo com privilégio total', async () => {
    const msg = await db
      .admin(
        `insert into transactions (household_id, type, amount_cents, occurred_on, description, owner_id, created_by, account_id)
       values ($1, 'income', 100, '2026-03-01', 'x', $2, $2, $3)`,
        [houseA, ana, accEve],
      )
      .then(
        () => 'passou',
        (e: Error) => e.message,
      );
    expect(msg).toMatch(/foreign key|violates/i);
  });
});

describe('papéis e associação', () => {
  it('usuário não altera o próprio papel, a casa ou a associação', async () => {
    expect(
      await db.as(bru).fails('update household_members set role = $2 where user_id = $1', [bru, 'admin']),
    ).toMatch(/permission denied/i);
    expect(
      await db
        .as(bru)
        .fails('update household_members set household_id = $2 where user_id = $1', [bru, houseE]),
    ).toMatch(/permission denied/i);
    expect(
      await db
        .as(bru)
        .fails(
          'insert into household_members (household_id, user_id, role, display_name) values ($1, $2, $3, $4)',
          [houseE, bru, 'admin', 'x'],
        ),
    ).toMatch(/permission denied/i);
    expect(await db.as(bru).fails('delete from household_members where user_id = $1', [ana])).toMatch(
      /permission denied/i,
    );
    const [row] = await db.admin<{ role: string }>('select role from household_members where user_id = $1', [
      bru,
    ]);
    expect(row?.role).toBe('member');
  });

  it('pode editar apenas o próprio nome de exibição', async () => {
    expect(
      await db
        .as(bru)
        .query('update household_members set display_name = $2 where user_id = $1 returning id', [
          bru,
          'Bruno',
        ]),
    ).toHaveLength(1);
    expect(
      await db
        .as(bru)
        .query('update household_members set display_name = $2 where user_id = $1 returning id', [
          ana,
          'Hack',
        ]),
    ).toHaveLength(0);
  });

  it('membro comum não cria convites nem lê tabela de convites', async () => {
    expect(await db.as(bru).rpcFails('create_invitation', houseA, null, 24)).toMatch(/administradores/i);
    expect(await db.as(bru).query('select id from household_invitations')).toHaveLength(0);
  });

  it('token_hash nunca é legível pelo cliente', async () => {
    expect(await db.as(ana).fails('select token_hash from household_invitations')).toMatch(
      /permission denied/i,
    );
  });

  it('quem já está numa casa não cria outra nem entra em outra', async () => {
    expect(await db.as(ana).rpcFails('create_household', 'Outra', 'Ana')).toMatch(/já participa/i);
    const inv = await db.as(eve).rpc<{ token: string }>('create_invitation', houseE, null, 24);
    expect(await db.as(ana).rpcFails('accept_invitation', inv.token, 'Ana')).toMatch(/já participa/i);
  });

  it('requer sessão válida', async () => {
    expect(await db.as(null).rpcFails('create_household', 'x', 'y')).toMatch(
      /permission denied|Sessão expirada/i,
    );
  });
});

describe('convites', () => {
  it('guarda só o hash (SHA-256 hex), com 244 bits de aleatoriedade, e uso único', async () => {
    const inv = await db
      .as(eve)
      .rpc<{ token: string; id: string }>('create_invitation', houseE, 'carl@teste.dev', 24);
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await db.admin<{ token_hash: string }>(
      'select token_hash from household_invitations where id = $1',
      [inv.id],
    );
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.token_hash).not.toBe(inv.token);
    expect(
      await db.admin('select 1 from household_invitations where token_hash = $1', [inv.token]),
    ).toHaveLength(0);

    await db.as(carl).rpc('accept_invitation', inv.token, 'Carl'); // eve + carl = 2 membros
    const another = await db.addUser('dave@teste.dev');
    expect(await db.as(another).rpcFails('accept_invitation', inv.token, 'Dave')).toMatch(
      /inválido ou expirado/i,
    );
  });

  it('expirado, revogado e inexistente têm a MESMA mensagem (sem enumeração)', async () => {
    const u1 = await db.addUser('u1@teste.dev');
    const expired = await db.as(ana).rpc<{ token: string; id: string }>('create_invitation', houseA, null, 1);
    await db.admin(
      "update household_invitations set expires_at = now() - interval '1 minute' where id = $1",
      [expired.id],
    );
    const revoked = await db
      .as(ana)
      .rpc<{ token: string; id: string }>('create_invitation', houseA, null, 24);
    await db.as(ana).rpc('revoke_invitation', revoked.id);
    const m1 = await db.as(u1).rpcFails('accept_invitation', expired.token, 'U');
    const m2 = await db.as(u1).rpcFails('accept_invitation', revoked.token, 'U');
    const m3 = await db.as(u1).rpcFails('accept_invitation', 'f'.repeat(64), 'U');
    expect(new Set([m1, m2, m3]).size).toBe(1);
    expect(m1).toMatch(/inválido ou expirado/i);
  });

  it('respeita o limite de 2 membros ativos (a casa já tem Ana e Bru)', async () => {
    const u2 = await db.addUser('u2@teste.dev');
    const inv = await db.as(ana).rpc<{ token: string }>('create_invitation', houseA, null, 24);
    expect(await db.as(u2).rpcFails('accept_invitation', inv.token, 'U2')).toMatch(/limite de membros/i);
    const [{ n }] = (await db.admin<{ n: number }>(
      'select count(*)::int as n from household_members where household_id = $1 and is_active',
      [houseA],
    )) as [{ n: number }];
    expect(n).toBe(2);
    // o trigger vale mesmo para inserts diretos (superusuário)
    const msg = await db
      .admin(`insert into household_members (household_id, user_id, display_name) values ($1, $2, 'x')`, [
        houseA,
        u2,
      ])
      .then(
        () => 'passou',
        (e: Error) => e.message,
      );
    expect(msg).toMatch(/limite de membros/i);
  });

  it('admin remove membro; o convite reabre a vaga', async () => {
    const [m] = await db.admin<{ id: string }>('select id from household_members where user_id = $1', [carl]);
    expect(await db.as(carl).rpcFails('remove_member', m!.id)).toMatch(/não encontrado/i);
    await db.as(eve).rpc('remove_member', m!.id);
    expect(await db.as(carl).query('select 1 from households')).toHaveLength(0); // sem acesso após remoção
  });
});
