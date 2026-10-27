// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignFingerprints, type NormalizedRow } from '../../../src/domain/imports/normalize';
import { createDb, type Db } from './harness';

let db: Db;
let ana: string, bru: string, house: string, acc: string, card: string;

const row = (n: number, over: Partial<NormalizedRow> = {}): NormalizedRow => ({
  rowNumber: n,
  raw: { n: String(n) },
  occurredOn: '2026-03-05',
  description: `Linha ${n}`,
  amountCents: 1000 * n,
  direction: 'out',
  externalId: null,
  rejectReason: null,
  fingerprint: null,
  ...over,
});

const payload = (rows: NormalizedRow[]) =>
  JSON.stringify(
    assignFingerprints(rows).map((r) => ({
      row_number: r.rowNumber,
      raw: r.raw,
      occurred_on: r.occurredOn,
      description: r.description,
      amount_cents: r.amountCents,
      direction: r.direction,
      external_id: r.externalId,
      fingerprint: r.fingerprint,
      reject_reason: r.rejectReason,
    })),
  );

async function stage(
  rows: NormalizedRow[],
  hash = randomUUID().replace(/-/g, '').padEnd(32, '0'),
  target: 'acc' | 'card' = 'acc',
) {
  return db
    .as(ana)
    .rpc<{ batch_id: string; repeated_file: boolean; valid: number; invalid: number; duplicates: number }>(
      'create_import_batch',
      house,
      target === 'acc' ? acc : null,
      target === 'card' ? card : null,
      'extrato.csv',
      'csv',
      hash,
      '{}',
      payload(rows),
    );
}

const batchRows = (batch: string) =>
  db.admin<{
    row_number: number;
    status: string;
    include: boolean;
    transaction_id: string | null;
    reject_reason: string | null;
  }>(
    'select row_number, status, include, transaction_id, reject_reason from import_rows where batch_id = $1 order by row_number',
    [batch],
  );

async function balance(): Promise<number> {
  const [r] = await db.admin<{ b: string }>(
    `select (a.initial_balance_cents + coalesce(sum(case when t.type = 'income' then t.amount_cents when t.type = 'expense' then -t.amount_cents end), 0))::text as b
     from accounts a left join transactions t on t.account_id = a.id and t.status = 'posted' where a.id = $1 group by a.id`,
    [acc],
  );
  return Number(r!.b);
}

beforeAll(async () => {
  db = await createDb();
  ana = await db.addUser('ana@t.dev');
  bru = await db.addUser('bru@t.dev');
  house = await db.as(ana).rpc<string>('create_household', 'Casa', 'Ana');
  const inv = await db.as(ana).rpc<{ token: string }>('create_invitation', house, null, 24);
  await db.as(bru).rpc('accept_invitation', inv.token, 'Bru');
  [{ id: acc }] = (await db
    .as(ana)
    .query<{ id: string }>(
      `insert into accounts (household_id, owner_id, name, type, initial_balance_cents, balance_date) values ($1,$2,'Corrente','checking',1000000,'2026-01-01') returning id`,
      [house, ana],
    )) as [{ id: string }];
  [{ id: card }] = (await db
    .as(ana)
    .query<{ id: string }>(
      `insert into credit_cards (household_id, owner_id, name, limit_cents, closing_day, due_day) values ($1,$2,'Visa',500000,25,5) returning id`,
      [house, ana],
    )) as [{ id: string }];
}, 120_000);

describe('importação: prévia, revisão e confirmação atômica', () => {
  let firstBatch: string;
  const file = [
    row(1, { externalId: 'F1', amountCents: 5000 }),
    row(2, { externalId: 'F2', amountCents: 2500, direction: 'in', description: 'PIX recebido' }),
    row(3, { externalId: 'F3', amountCents: 700 }),
    row(4, {
      rejectReason: 'Data inválida: "31/02/2026"',
      occurredOn: null,
      amountCents: null,
      direction: null,
      description: null,
    }),
  ];

  it('mostra válidas e inválidas; só as válidas vêm marcadas para importar', async () => {
    const r = await stage(file, 'hash-arquivo-1'.padEnd(32, '0'));
    firstBatch = r.batch_id;
    expect(r).toMatchObject({ valid: 3, invalid: 1, duplicates: 0, repeated_file: false });
    const rows = await batchRows(firstBatch);
    expect(rows.map((x) => [x.status, x.include])).toEqual([
      ['valid', true],
      ['valid', true],
      ['valid', true],
      ['invalid', false],
    ]);
    expect(rows[3]?.reject_reason).toMatch(/Data inválida/);
    expect(
      await db.admin('select 1 from transactions where import_batch_id = $1', [firstBatch]),
    ).toHaveLength(0); // prévia não grava lançamentos
  });

  it('confirmação cria os lançamentos escolhidos (aplicando categoria e exclusões) e é idempotente', async () => {
    const [cat] = await db.admin<{ id: string }>(
      "select id from categories where household_id = $1 and name = 'Mercado'",
      [house],
    );
    const rows = await db.admin<{ id: string; row_number: number }>(
      'select id, row_number from import_rows where batch_id = $1 order by row_number',
      [firstBatch],
    );
    const decisions = JSON.stringify([
      { row_id: rows[0]!.id, include: true, category_id: cat!.id, description: 'Mercado Bairro' },
      { row_id: rows[2]!.id, include: false },
      { row_id: rows[3]!.id, include: true }, // inválida: ignorada mesmo que o cliente peça
    ]);
    const before = await balance();
    const req = randomUUID();
    const a = await db.as(ana).rpc<{ imported: number }>('confirm_import', firstBatch, req, decisions);
    const b = await db.as(ana).rpc<{ imported: number }>('confirm_import', firstBatch, req, decisions);
    expect(a.imported).toBe(2);
    expect(b).toEqual(a);
    expect(await balance()).toBe(before - 5000 + 2500);
    const [t] = await db.admin<{
      description: string;
      source: string;
      source_id: string;
      category_id: string;
    }>(
      "select description, source, source_id, category_id from transactions where import_batch_id = $1 and source_id = 'F1'",
      [firstBatch],
    );
    expect(t).toMatchObject({
      description: 'Mercado Bairro',
      source: 'import',
      source_id: 'F1',
      category_id: cat!.id,
    });
    // nova tentativa com outra chave também não duplica
    expect(await db.as(ana).rpc('confirm_import', firstBatch, randomUUID(), '[]')).toMatchObject({
      already_confirmed: true,
    });
    expect(
      await db.admin('select 1 from transactions where import_batch_id = $1', [firstBatch]),
    ).toHaveLength(2);
  });

  it('reimportar o MESMO arquivo avisa e marca as duplicatas — nunca importa em silêncio', async () => {
    const r = await stage(file, 'hash-arquivo-1'.padEnd(32, '0'));
    expect(r.repeated_file).toBe(true);
    const rows = await batchRows(r.batch_id);
    expect(rows.map((x) => x.status)).toEqual(['duplicate', 'duplicate', 'valid', 'invalid']); // F3 foi excluída antes → continua importável
    expect(rows[0]?.include).toBe(false);
    expect(rows[0]?.reject_reason).toMatch(/já importado/i);
    const res = await db.as(ana).rpc<{ imported: number }>('confirm_import', r.batch_id, randomUUID(), '[]');
    expect(res.imported).toBe(1); // somente F3
  });

  it('lançamento manual parecido (mesma data e valor) vira "revisão", não descarte', async () => {
    await db
      .as(ana)
      .rpc('create_transaction', house, randomUUID(), 'expense', 12345, '2026-03-09', 'Farmácia', null, acc);
    const r = await stage([
      row(1, { occurredOn: '2026-03-09', amountCents: 12345, description: 'DROGARIA XYZ' }),
    ]);
    const [x] = await batchRows(r.batch_id);
    expect(x).toMatchObject({ status: 'review', include: false });
    expect(x?.reject_reason).toMatch(/parecido/i);
    // usuário decide importar mesmo assim
    const [id] = await db.admin<{ id: string }>('select id from import_rows where batch_id = $1', [
      r.batch_id,
    ]);
    const res = await db
      .as(ana)
      .rpc<{ imported: number }>(
        'confirm_import',
        r.batch_id,
        randomUUID(),
        JSON.stringify([{ row_id: id!.id, include: true }]),
      );
    expect(res.imported).toBe(1);
  });

  it('sem identificador: assinatura detecta reimportação linha a linha; compras iguais no mesmo arquivo são ambas mantidas', async () => {
    const coffees = [
      row(1, { description: 'Café', amountCents: 800, occurredOn: '2026-03-11' }),
      row(2, { description: 'Café', amountCents: 800, occurredOn: '2026-03-11' }),
    ];
    const r1 = await stage(coffees, 'hash-cafe-1'.padEnd(32, '0'));
    expect(r1).toMatchObject({ valid: 2, duplicates: 0 });
    expect(
      (await db.as(ana).rpc<{ imported: number }>('confirm_import', r1.batch_id, randomUUID(), '[]'))
        .imported,
    ).toBe(2);
    const r2 = await stage(coffees, 'hash-cafe-1'.padEnd(32, '0'));
    expect(r2).toMatchObject({ valid: 0, duplicates: 2, repeated_file: true });
    // com 3 cafés agora: #1 e #2 casam pela assinatura; o #3 não tem assinatura igual, mas é SINALIZADO como parecido
    // (mesma data/valor de lançamentos existentes) para revisão manual — nunca descartado nem importado em silêncio
    const r3 = await stage(
      [...coffees, row(3, { description: 'Café', amountCents: 800, occurredOn: '2026-03-11' })],
      'hash-cafe-3'.padEnd(32, '0'),
    );
    const rows3 = await batchRows(r3.batch_id);
    expect(rows3.map((x) => x.status)).toEqual(['review', 'review', 'review']);
    expect(rows3[0]?.reject_reason).toMatch(/mesma assinatura/);
    expect(rows3[2]?.reject_reason).toMatch(/parecido/);
    expect(rows3.every((x) => x.include === false)).toBe(true);
  });

  it('falha no meio NÃO deixa metade importada (rollback do lote inteiro)', async () => {
    const r = await stage([
      row(1, { externalId: 'OK1', amountCents: 111 }),
      row(2, { externalId: 'OK2', amountCents: 222 }),
      row(3, { externalId: 'F1', amountCents: 5000 }), // F1 já existe → duplicate
    ]);
    const rows = await db.admin<{ id: string; row_number: number; status: string }>(
      'select id, row_number, status from import_rows where batch_id = $1 order by row_number',
      [r.batch_id],
    );
    expect(rows[2]?.status).toBe('duplicate');
    const before = await balance();
    // o usuário (ou um cliente adulterado) força a inclusão da duplicata → violação do índice único no meio do lote
    const decisions = JSON.stringify([{ row_id: rows[2]!.id, include: true }]);
    const msg = await db.as(ana).rpcFails('confirm_import', r.batch_id, randomUUID(), decisions);
    expect(msg).toMatch(/duplicate key|unique|violates/i);
    expect(
      await db.admin('select 1 from transactions where import_batch_id = $1', [r.batch_id]),
    ).toHaveLength(0);
    expect(await balance()).toBe(before);
    const [b] = await db.admin<{ status: string; imported_rows: number }>(
      'select status, imported_rows from import_batches where id = $1',
      [r.batch_id],
    );
    expect(b).toEqual({ status: 'preview', imported_rows: 0 });
    // sem forçar a duplicata, o mesmo lote confirma normalmente
    expect(
      (await db.as(ana).rpc<{ imported: number }>('confirm_import', r.batch_id, randomUUID(), '[]')).imported,
    ).toBe(2);
  });

  it('cartão: compras entram nas faturas certas, crédito vira estorno; sem débito na conta', async () => {
    const before = await balance();
    const r = await stage(
      [
        row(1, { occurredOn: '2026-03-10', amountCents: 20000, description: 'Loja A' }),
        row(2, { occurredOn: '2026-03-25', amountCents: 3000, description: 'No fechamento' }),
        row(3, { occurredOn: '2026-03-12', amountCents: 5000, direction: 'in', description: 'Estorno loja' }),
      ],
      undefined,
      'card',
    );
    await db.as(ana).rpc('confirm_import', r.batch_id, randomUUID(), '[]');
    const inv = await db.admin<{ closing_date: Date; total_cents: string }>(
      'select closing_date, total_cents from v_card_invoices where card_id = $1 order by closing_date',
      [card],
    );
    expect(inv.map((i) => [i.closing_date.toISOString().slice(0, 10), Number(i.total_cents)])).toEqual([
      ['2026-03-25', 15000],
      ['2026-04-25', 3000],
    ]);
    expect(await balance()).toBe(before);
  });

  it('desfazer importação cancela os lançamentos (exclusão lógica) e libera o arquivo', async () => {
    const r = await stage([row(1, { externalId: 'UNDO1', amountCents: 900 })]);
    await db.as(ana).rpc('confirm_import', r.batch_id, randomUUID(), '[]');
    const before = await balance();
    await db.as(ana).rpc('revert_import', r.batch_id);
    expect(await balance()).toBe(before + 900);
    const again = await stage([row(1, { externalId: 'UNDO1', amountCents: 900 })]);
    expect(again.duplicates).toBe(0); // cancelado não conta como duplicata
  });

  it('permissões: parceiro vê o histórico mas não confirma nem importa em conta alheia', async () => {
    const r = await stage([row(1, { amountCents: 321 })]);
    expect(await db.as(bru).query('select id from import_batches where id = $1', [r.batch_id])).toHaveLength(
      1,
    );
    expect(await db.as(bru).rpcFails('confirm_import', r.batch_id, randomUUID(), '[]')).toMatch(
      /quem iniciou/i,
    );
    expect(
      await db
        .as(bru)
        .rpcFails(
          'create_import_batch',
          house,
          acc,
          null,
          'x.csv',
          'csv',
          'h'.repeat(32),
          '{}',
          payload([row(1)]),
        ),
    ).toMatch(/suas/i);
  });

  it('valida limites: vazio, destino ambíguo, linhas demais', async () => {
    expect(
      await db
        .as(ana)
        .rpcFails('create_import_batch', house, acc, null, 'x.csv', 'csv', 'h'.repeat(32), '{}', '[]'),
    ).toMatch(/não tem linhas/i);
    expect(
      await db
        .as(ana)
        .rpcFails(
          'create_import_batch',
          house,
          acc,
          card,
          'x.csv',
          'csv',
          'h'.repeat(32),
          '{}',
          payload([row(1)]),
        ),
    ).toMatch(/conta OU um cartão/i);
    const many = JSON.stringify(Array.from({ length: 5001 }, (_, i) => ({ row_number: i + 1 })));
    expect(
      await db
        .as(ana)
        .rpcFails('create_import_batch', house, acc, null, 'x.csv', 'csv', 'h'.repeat(32), '{}', many),
    ).toMatch(/5\.000/);
  });
});
