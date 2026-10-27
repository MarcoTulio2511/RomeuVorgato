// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { invoiceCycleFor } from '../../../src/domain/invoices/invoices';
import { occurrencesBetween } from '../../../src/domain/projections/recurrence';
import { addDays, todayISO } from '../../../src/domain/dates';
import { recurring } from '../../helpers/factories';
import { createDb, type Db } from './harness';

let db: Db;
let ana: string, bru: string;
let house: string;
let acc1: string, acc2: string, accBru: string, card: string, cat: string;

const id = () => randomUUID();
const asAna = () => db.as(ana);

async function balance(account: string): Promise<number> {
  const [r] = await db.admin<{ b: string }>(
    `select (a.initial_balance_cents + coalesce(sum(case
        when t.type in ('income','refund','transfer_in','adjustment_in') then t.amount_cents
        when t.type in ('expense','transfer_out','invoice_payment','adjustment_out') then -t.amount_cents end), 0))::text as b
     from accounts a left join transactions t on t.account_id = a.id and t.status = 'posted' and t.occurred_on >= a.balance_date
     where a.id = $1 group by a.id`,
    [account],
  );
  return Number(r!.b);
}

async function invoiceOf(txId: string) {
  const [r] = await db.admin<Record<string, unknown>>(
    `select v.* from transactions t join v_card_invoices v on v.id = t.invoice_id where t.id = $1`,
    [txId],
  );
  return r!;
}

beforeAll(async () => {
  db = await createDb();
  ana = await db.addUser('ana@teste.dev');
  bru = await db.addUser('bru@teste.dev');
  house = await asAna().rpc<string>('create_household', 'Casa', 'Ana');
  const inv = await asAna().rpc<{ token: string }>('create_invitation', house, null, 24);
  await db.as(bru).rpc('accept_invitation', inv.token, 'Bru');
  const ins = async (who: string, sql: string, params: unknown[]) =>
    (await db.as(who).query<{ id: string }>(sql, params))[0]!.id;
  acc1 = await ins(
    ana,
    `insert into accounts (household_id, owner_id, name, type, initial_balance_cents, balance_date) values ($1,$2,'Corrente','checking',100000,'2026-01-01') returning id`,
    [house, ana],
  );
  acc2 = await ins(
    ana,
    `insert into accounts (household_id, owner_id, name, type, initial_balance_cents, balance_date) values ($1,$2,'Poupança','savings',0,'2026-01-01') returning id`,
    [house, ana],
  );
  accBru = await ins(
    bru,
    `insert into accounts (household_id, owner_id, name, type, initial_balance_cents, balance_date) values ($1,$2,'Conta Bru','checking',20000,'2026-01-01') returning id`,
    [house, bru],
  );
  card = await ins(
    ana,
    `insert into credit_cards (household_id, owner_id, name, limit_cents, closing_day, due_day, pay_account_id) values ($1,$2,'Visa',500000,25,5,$3) returning id`,
    [house, ana, acc1],
  );
  [{ id: cat }] = (await db.admin<{ id: string }>(
    `select id from categories where household_id = $1 and name = 'Mercado'`,
    [house],
  )) as [{ id: string }];
}, 120_000);

describe('lançamentos e saldo', () => {
  it('receita, despesa e saldo da conta (data-base respeitada)', async () => {
    await asAna().rpc(
      'create_transaction',
      house,
      id(),
      'income',
      50000,
      '2026-02-01',
      'Salário',
      null,
      acc1,
    );
    await asAna().rpc(
      'create_transaction',
      house,
      id(),
      'expense',
      20000,
      '2026-02-02',
      'Mercado',
      cat,
      acc1,
    );
    // anterior à data-base: não altera o saldo
    await db.admin(
      `insert into transactions (household_id, type, amount_cents, occurred_on, description, owner_id, created_by, account_id)
      values ($1,'expense',99999,'2025-12-31','antigo',$2,$2,$3)`,
      [house, ana, acc1],
    );
    expect(await balance(acc1)).toBe(130000);
  });

  it('é idempotente: mesmo request_id não duplica (clique duplo/reenvio)', async () => {
    const req = id();
    const a = await asAna().rpc<{ id: string }>(
      'create_transaction',
      house,
      req,
      'expense',
      1234,
      '2026-02-03',
      'Padaria',
      cat,
      acc1,
    );
    const b = await asAna().rpc<{ id: string }>(
      'create_transaction',
      house,
      req,
      'expense',
      1234,
      '2026-02-03',
      'Padaria',
      cat,
      acc1,
    );
    expect(b.id).toBe(a.id);
    expect(await db.admin('select 1 from transactions where description = $1', ['Padaria'])).toHaveLength(1);
    // mesma chave em outra operação é recusada
    expect(await asAna().rpcFails('create_transfer', house, req, acc1, acc2, 100, '2026-02-03', 'x')).toMatch(
      /outra operação/i,
    );
  });

  it('valida combinações inválidas no banco (tipo × conta × cartão)', async () => {
    const bad = (sql: string, p: unknown[]) =>
      db.admin(sql, p).then(
        () => 'passou',
        (e: Error) => e.message,
      );
    expect(
      await bad(
        `insert into transactions (household_id, type, amount_cents, occurred_on, description, owner_id, created_by, account_id) values ($1,'card_purchase',100,'2026-02-01','x',$2,$2,$3)`,
        [house, ana, acc1],
      ),
    ).toMatch(/tx_card_types|check/i);
    expect(
      await bad(
        `insert into transactions (household_id, type, amount_cents, occurred_on, description, owner_id, created_by, account_id, card_id) values ($1,'income',100,'2026-02-01','x',$2,$2,$3,$4)`,
        [house, ana, acc1, card],
      ),
    ).toMatch(/tx_account_types|check/i);
    expect(
      await bad(
        `insert into transactions (household_id, type, amount_cents, occurred_on, description, owner_id, created_by, account_id) values ($1,'income',-5,'2026-02-01','x',$2,$2,$3)`,
        [house, ana, acc1],
      ),
    ).toMatch(/check/i);
    expect(
      await bad(
        `insert into transactions (household_id, type, amount_cents, occurred_on, description, owner_id, created_by, account_id) values ($1,'transfer_out',5,'2026-02-01','x',$2,$2,$3)`,
        [house, ana, acc1],
      ),
    ).toMatch(/tx_transfer_group|check/i);
  });

  it('ajuste exige justificativa e fica na auditoria', async () => {
    expect(
      await asAna().rpcFails(
        'create_transaction',
        house,
        id(),
        'adjustment_in',
        500,
        '2026-02-04',
        'Ajuste',
        null,
        acc1,
        null,
        'individual',
        null,
      ),
    ).toMatch(/tx_adjustment_reason|check/i);
    const r = await asAna().rpc<{ id: string }>(
      'create_transaction',
      house,
      id(),
      'adjustment_in',
      500,
      '2026-02-04',
      'Ajuste',
      null,
      acc1,
      null,
      'individual',
      'Conferido no extrato',
    );
    const audit = await db.admin('select action from transaction_audit where transaction_id = $1', [r.id]);
    expect(audit.map((a) => a.action)).toEqual(['insert']);
  });

  it('edição e cancelamento são lógicos e auditados', async () => {
    const r = await asAna().rpc<{ id: string }>(
      'create_transaction',
      house,
      id(),
      'expense',
      700,
      '2026-02-05',
      'Café',
      cat,
      acc1,
    );
    await asAna().rpc('update_transaction', r.id, 'Café especial', null, false, null, null, null, 900);
    await asAna().rpc('cancel_transaction', r.id, id());
    const [row] = await db.admin<{ status: string; amount_cents: string; description: string }>(
      'select * from transactions where id = $1',
      [r.id],
    );
    expect(row).toMatchObject({ status: 'cancelled', description: 'Café especial' });
    expect(Number(row!.amount_cents)).toBe(900);
    const audit = await db.admin<{ action: string }>(
      'select action from transaction_audit where transaction_id = $1 order by id',
      [r.id],
    );
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update', 'update']);
    expect(await db.as(bru).rpcFails('cancel_transaction', r.id, null)).toMatch(/seus|cancelad/i);
  });

  it('estorno: cria lançamento inverso ligado ao original, uma única vez', async () => {
    const t = await asAna().rpc<{ id: string }>(
      'create_transaction',
      house,
      id(),
      'expense',
      4000,
      '2026-02-06',
      'Loja',
      cat,
      acc1,
    );
    const before = await balance(acc1);
    const rev = await asAna().rpc<{ id: string }>('reverse_transaction', t.id, id(), '2026-02-07');
    expect(await balance(acc1)).toBe(before + 4000);
    const [row] = await db.admin<{ type: string; reversal_of_id: string }>(
      'select type, reversal_of_id from transactions where id = $1',
      [rev.id],
    );
    expect(row).toEqual({ type: 'refund', reversal_of_id: t.id });
    expect(await asAna().rpcFails('reverse_transaction', t.id, id(), '2026-02-08')).toMatch(
      /já foi estornado/i,
    );
  });
});

describe('transferências', () => {
  it('geram duas pernas, movem saldo e não alteram o total consolidado', async () => {
    const b1 = await balance(acc1);
    const b2 = await balance(acc2);
    const bb = await balance(accBru);
    const r = await asAna().rpc<{ transfer_group_id: string }>(
      'create_transfer',
      house,
      id(),
      acc1,
      acc2,
      30000,
      '2026-02-10',
      'Reserva',
    );
    await asAna().rpc('create_transfer', house, id(), acc1, accBru, 5000, '2026-02-10', 'Para o Bru');
    expect(await balance(acc1)).toBe(b1 - 35000);
    expect(await balance(acc2)).toBe(b2 + 30000);
    expect(await balance(accBru)).toBe(bb + 5000);
    const legs = await db.admin('select type from transactions where transfer_group_id = $1 order by type', [
      r.transfer_group_id,
    ]);
    expect(legs.map((l) => l.type)).toEqual(['transfer_in', 'transfer_out']);
  });

  it('cancelar uma perna cancela as duas', async () => {
    const r = await asAna().rpc<{ transfer_group_id: string; out_id: string }>(
      'create_transfer',
      house,
      id(),
      acc1,
      acc2,
      1000,
      '2026-02-11',
      'x',
    );
    await asAna().rpc('cancel_transaction', r.out_id, id());
    const rows = await db.admin<{ status: string }>(
      'select status from transactions where transfer_group_id = $1',
      [r.transfer_group_id],
    );
    expect(rows.map((x) => x.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('recusa mesma conta de origem e destino', async () => {
    expect(await asAna().rpcFails('create_transfer', house, id(), acc1, acc1, 1, '2026-02-10', 'x')).toMatch(
      /diferentes/i,
    );
  });
});

describe('cartão, fatura e pagamento', () => {
  let purchaseId: string;
  let invoiceId: string;

  it('compra no cartão não mexe no saldo e cria a obrigação na fatura certa (fechamento dia 25)', async () => {
    const before = await balance(acc1);
    const r = await asAna().rpc<{ id: string }>(
      'create_transaction',
      house,
      id(),
      'card_purchase',
      30000,
      '2026-03-10',
      'Eletrônico',
      cat,
      null,
      card,
    );
    purchaseId = r.id;
    await asAna().rpc(
      'create_transaction',
      house,
      id(),
      'card_purchase',
      20000,
      '2026-03-24',
      'Restaurante',
      cat,
      null,
      card,
    );
    // no dia do fechamento (regra 'next') cai na fatura seguinte
    const onClosing = await asAna().rpc<{ id: string }>(
      'create_transaction',
      house,
      id(),
      'card_purchase',
      5000,
      '2026-03-25',
      'No fechamento',
      cat,
      null,
      card,
    );
    await asAna().rpc(
      'create_transaction',
      house,
      id(),
      'card_fee',
      1000,
      '2026-03-12',
      'Anuidade',
      null,
      null,
      card,
    );
    await asAna().rpc(
      'create_transaction',
      house,
      id(),
      'card_refund',
      5000,
      '2026-03-15',
      'Estorno loja',
      cat,
      null,
      card,
    );
    expect(await balance(acc1)).toBe(before);
    const inv = await invoiceOf(purchaseId);
    invoiceId = inv.id as string;
    expect(inv).toMatchObject({ closing_date: new Date('2026-03-25T00:00:00Z') });
    expect([Number(inv.total_cents), Number(inv.paid_cents)]).toEqual([46000, 0]);
    const next = await invoiceOf(onClosing.id);
    expect(next.id).not.toBe(invoiceId);
    expect(String(next.total_cents)).toBe('5000');
  });

  it('pagamento parcial reduz o saldo da fatura, debita a conta e NÃO quita', async () => {
    const before = await balance(acc1);
    const req = id();
    const p1 = await asAna().rpc<{ id: string; remaining_cents: number }>(
      'pay_invoice',
      invoiceId,
      req,
      acc1,
      10000,
      '2026-04-01',
    );
    const again = await asAna().rpc<{ id: string }>('pay_invoice', invoiceId, req, acc1, 10000, '2026-04-01'); // clique duplo
    expect(again.id).toBe(p1.id);
    expect(p1.remaining_cents).toBe(36000);
    expect(await balance(acc1)).toBe(before - 10000);
    const [v] = await db.admin<{ outstanding_cents: string; status: string }>(
      'select outstanding_cents, status from v_card_invoices where id = $1',
      [invoiceId],
    );
    expect(Number(v!.outstanding_cents)).toBe(36000);
    expect(v!.status).not.toBe('paid');
  });

  it('não paga além do saldo e quita no segundo pagamento, sem criar nova despesa', async () => {
    expect(await asAna().rpcFails('pay_invoice', invoiceId, id(), acc1, 36001, '2026-04-02')).toMatch(
      /excede/i,
    );
    await asAna().rpc('pay_invoice', invoiceId, id(), acc1, 36000, '2026-04-02');
    const [v] = await db.admin<{ outstanding_cents: string; status: string }>(
      'select outstanding_cents, status from v_card_invoices where id = $1',
      [invoiceId],
    );
    expect(Number(v!.outstanding_cents)).toBe(0);
    expect(v!.status).toBe('paid');
    expect(await asAna().rpcFails('pay_invoice', invoiceId, id(), acc1, 1, '2026-04-03')).toMatch(
      /não tem saldo/i,
    );
    // consumo (despesa) de março no cartão continua 46.000 − estorno: pagamentos não entram
    const [{ spent }] = (await db.admin<{ spent: string }>(
      `select (sum(case when type in ('card_purchase','card_fee') then amount_cents when type = 'card_refund' then -amount_cents end))::text as spent
       from transactions where invoice_id = $1 and status = 'posted'`,
      [invoiceId],
    )) as [{ spent: string }];
    expect(spent).toBe('46000');
  });

  it('só o titular da conta paga; cartão de outra pessoa exige conta própria', async () => {
    expect(await db.as(bru).rpcFails('pay_invoice', invoiceId, id(), acc1, 1, '2026-04-03')).toMatch(
      /não tem saldo|suas/i,
    );
  });
});

describe('compras parceladas', () => {
  it('R$ 100,00 em 3x: 33,34 + 33,33 + 33,33, faturas consecutivas, soma exata', async () => {
    const req = id();
    const r = await asAna().rpc<{ plan_id: string }>(
      'create_installment_purchase',
      house,
      req,
      card,
      'Cadeira',
      10000,
      3,
      '2026-11-10',
      cat,
      'shared',
      null,
    );
    const rows = await db.admin<{ number: number; amount_cents: string; due_date: Date; closing_date: Date }>(
      `select i.number, i.amount_cents, i.due_date, ci.closing_date from installments i join card_invoices ci on ci.id = i.invoice_id
       where i.plan_id = $1 order by i.number`,
      [r.plan_id],
    );
    expect(rows.map((x) => Number(x.amount_cents))).toEqual([3334, 3333, 3333]);
    expect(rows.map((x) => x.closing_date.toISOString().slice(0, 10))).toEqual([
      '2026-11-25',
      '2026-12-25',
      '2027-01-25',
    ]);
    expect(rows.map((x) => x.due_date.toISOString().slice(0, 10))).toEqual([
      '2026-12-05',
      '2027-01-05',
      '2027-02-05',
    ]);
    const [{ s }] = (await db.admin<{ s: string }>(
      'select sum(amount_cents)::text as s from transactions where installment_plan_id = $1',
      [r.plan_id],
    )) as [{ s: string }];
    expect(s).toBe('10000');
    // reenvio não duplica parcelas
    await asAna().rpc(
      'create_installment_purchase',
      house,
      req,
      card,
      'Cadeira',
      10000,
      3,
      '2026-11-10',
      cat,
      'shared',
      null,
    );
    expect(await db.admin('select 1 from installments where plan_id = $1', [r.plan_id])).toHaveLength(3);
    expect(await db.admin("select 1 from installment_plans where description = 'Cadeira'")).toHaveLength(1);
  });

  it('parcelas em meses curtos e total que não divide por 7', async () => {
    const r = await asAna().rpc<{ plan_id: string }>(
      'create_installment_purchase',
      house,
      id(),
      card,
      'Sofá',
      100,
      7,
      '2026-01-31',
      null,
      'individual',
      null,
    );
    const rows = await db.admin<{ amount_cents: string; comp: string }>(
      `select i.amount_cents, to_char(i.competence_date, 'YYYY-MM-DD') as comp from installments i where plan_id = $1 order by number`,
      [r.plan_id],
    );
    expect(rows.map((x) => Number(x.amount_cents))).toEqual([15, 15, 14, 14, 14, 14, 14]);
    expect(rows.slice(0, 3).map((x) => x.comp)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('a verificação diferida impede parcelas que não somam o total (atomicidade)', async () => {
    await db.pg.exec('reset role');
    const planId = id();
    let msg = 'passou';
    try {
      await db.pg.exec(`
        begin;
        insert into installment_plans (id, household_id, description, total_cents, installment_count, purchase_date, card_id, owner_id, created_by)
          values ('${planId}', '${house}', 'Torto', 1000, 2, '2026-05-01', '${card}', '${ana}', '${ana}');
        insert into installments (household_id, plan_id, number, amount_cents, competence_date, due_date)
          values ('${house}', '${planId}', 1, 400, '2026-05-01', '2026-06-05');
        insert into installments (household_id, plan_id, number, amount_cents, competence_date, due_date)
          values ('${house}', '${planId}', 2, 500, '2026-06-01', '2026-07-05');
        commit;`);
    } catch (e) {
      msg = (e as Error).message;
      await db.pg.exec('rollback');
    }
    expect(msg).toMatch(/não somam exatamente/i);
    expect(await db.admin('select 1 from installment_plans where id = $1', [planId])).toHaveLength(0);
  });

  it('cancelar o parcelamento cancela todas as parcelas; recusa se já houve pagamento', async () => {
    const r = await asAna().rpc<{ plan_id: string }>(
      'create_installment_purchase',
      house,
      id(),
      card,
      'Mesa',
      9000,
      3,
      '2027-03-10',
      null,
      'individual',
      null,
    );
    await asAna().rpc('cancel_installment_plan', r.plan_id, id());
    const st = await db.admin<{ status: string }>(
      'select distinct status from transactions where installment_plan_id = $1',
      [r.plan_id],
    );
    expect(st.map((s) => s.status)).toEqual(['cancelled']);

    const p2 = await asAna().rpc<{ plan_id: string }>(
      'create_installment_purchase',
      house,
      id(),
      card,
      'Armário',
      9000,
      3,
      '2027-06-10',
      null,
      'individual',
      null,
    );
    const [first] = await db.admin<{ invoice_id: string }>(
      'select invoice_id from transactions where installment_plan_id = $1 and installment_number = 1',
      [p2.plan_id],
    );
    await asAna().rpc('pay_invoice', first!.invoice_id, id(), acc1, 1000, '2027-07-01');
    expect(await asAna().rpcFails('cancel_installment_plan', p2.plan_id, id())).toMatch(
      /já receberam pagamento/i,
    );
  });

  it('parcela individual não pode ser cancelada nem ter o valor editado', async () => {
    const [t] = await db.admin<{ id: string }>(
      "select id from transactions where description = 'Sofá (1/7)'",
    );
    expect(await asAna().rpcFails('cancel_transaction', t!.id, null)).toMatch(/parcelamento inteiro/i);
    expect(
      await asAna().rpcFails('update_transaction', t!.id, null, null, false, null, null, null, 5),
    ).toMatch(/não podem ser editados/i);
  });
});

describe('planejamento: recorrências e previstos', () => {
  let ruleId: string;
  const today = todayISO();

  it('materialização é idempotente e não cria lançamentos reais', async () => {
    const start = addDays(today, 1);
    [{ id: ruleId }] = (await db.as(ana).query<{ id: string }>(
      `insert into recurring_transactions (household_id, description, type, amount_cents, frequency, start_date, owner_id, account_id, scope, is_subscription)
       values ($1,'Netflix','expense',3990,'monthly',$2,$3,$4,'shared',true) returning id`,
      [house, start, ana, acc1],
    )) as [{ id: string }];
    const until = addDays(today, 75);
    const before = (await db.admin('select 1 from transactions')).length;
    const a = await asAna().rpc<{ created: number }>('materialize_recurring', house, until, null);
    const b = await asAna().rpc<{ created: number }>('materialize_recurring', house, until, null);
    expect(a.created).toBeGreaterThanOrEqual(2);
    expect(b.created).toBe(0);
    expect((await db.admin('select 1 from transactions')).length).toBe(before);
    const keys = await db.admin<{ occurrence_key: string }>(
      'select occurrence_key from planned_transactions where recurring_id = $1',
      [ruleId],
    );
    expect(new Set(keys.map((k) => k.occurrence_key)).size).toBe(keys.length);
  });

  it('efetivar cria o lançamento real e fecha o previsto; cancelar o lançamento reabre o previsto', async () => {
    const [pl] = await db.admin<{ id: string }>(
      'select id from planned_transactions where recurring_id = $1 order by due_date limit 1',
      [ruleId],
    );
    const req = id();
    const s = await asAna().rpc<{ id: string }>('settle_planned', pl!.id, req, null, null, null, today);
    const s2 = await asAna().rpc<{ id: string }>('settle_planned', pl!.id, req, null, null, null, today);
    expect(s2.id).toBe(s.id);
    const [row] = await db.admin<{ status: string; transaction_id: string }>(
      'select status, transaction_id from planned_transactions where id = $1',
      [pl!.id],
    );
    expect(row).toEqual({ status: 'realized', transaction_id: s.id });
    expect(await asAna().rpcFails('settle_planned', pl!.id, id(), null, null, null, today)).toMatch(
      /já foi efetivada/i,
    );
    await asAna().rpc('cancel_transaction', s.id, id());
    const [back] = await db.admin<{ status: string; transaction_id: string | null }>(
      'select status, transaction_id from planned_transactions where id = $1',
      [pl!.id],
    );
    expect(back).toEqual({ status: 'planned', transaction_id: null });
  });

  it('cliente não consegue marcar previsto como efetivado direto (só via RPC)', async () => {
    const [pl] = await db.admin<{ id: string }>(
      'select id from planned_transactions where recurring_id = $1 limit 1',
      [ruleId],
    );
    expect(
      await db.as(ana).fails("update planned_transactions set status = 'realized' where id = $1", [pl!.id]),
    ).toMatch(/permission denied/i);
  });
});

describe('paridade SQL × TypeScript', () => {
  it('ciclo de fatura idêntico para muitas datas, regras e dias de fechamento', async () => {
    const cases: Array<[number, number, 'next' | 'current']> = [
      [25, 5, 'next'],
      [25, 5, 'current'],
      [3, 10, 'next'],
      [31, 10, 'next'],
      [31, 30, 'current'],
      [29, 1, 'next'],
      [1, 28, 'current'],
    ];
    for (const [closingDay, dueDay, rule] of cases) {
      const rows = await db.admin<Record<string, Date>>(
        `select d::date as d, c.* from generate_series(date '2026-01-01', date '2028-03-05', interval '1 day') d,
         lateral public._card_cycle($1, $2, $3, public._card_closing_for($1, $3, d::date)) c`,
        [closingDay, dueDay, rule],
      );
      for (const r of rows) {
        const iso = (x: Date) => x.toISOString().slice(0, 10);
        const ts = invoiceCycleFor({ closingDay, dueDay, closingDayRule: rule }, iso(r.d!));
        expect(
          { s: iso(r.cycle_start!), e: iso(r.cycle_end!), c: iso(r.closing_date!), d: iso(r.due_date!) },
          `${closingDay}/${dueDay}/${rule} @ ${iso(r.d!)}`,
        ).toEqual({ s: ts.cycleStart, e: ts.cycleEnd, c: ts.closingDate, d: ts.dueDate });
      }
    }
  });

  it('recorrência idêntica (mensal dia 31, semanal, quinzenal, anual 29/02, fim de semana)', async () => {
    const rules = [
      recurring({ id: 'r', frequency: 'monthly', startDate: '2026-01-31', weekendRule: 'none' }),
      recurring({ id: 'r', frequency: 'monthly', startDate: '2026-03-07', weekendRule: 'next_business_day' }),
      recurring({
        id: 'r',
        frequency: 'monthly',
        startDate: '2026-03-08',
        weekendRule: 'previous_business_day',
        intervalCount: 2,
      }),
      recurring({ id: 'r', frequency: 'weekly', startDate: '2026-03-02', weekendRule: 'none' }),
      recurring({
        id: 'r',
        frequency: 'biweekly',
        startDate: '2026-03-07',
        weekendRule: 'previous_business_day',
      }),
      recurring({ id: 'r', frequency: 'yearly', startDate: '2024-02-29', weekendRule: 'none' }),
    ];
    for (const rule of rules) {
      const sqlRows = await db.admin<{ due: string }>(
        `select to_char(public._adjust_weekend(public._recurrence_nth($1, $2, $3::date, k), $4), 'YYYY-MM-DD') as due
         from generate_series(0, 40) k
         where public._adjust_weekend(public._recurrence_nth($1, $2, $3::date, k), $4) between date '2026-01-01' and date '2028-12-31'
         order by 1`,
        [rule.frequency, rule.intervalCount, rule.startDate, rule.weekendRule],
      );
      const ts = occurrencesBetween(rule, '2026-01-01', '2028-12-31')
        .map((o) => o.due)
        .slice(0, sqlRows.length);
      expect(sqlRows.map((r) => r.due).slice(0, ts.length)).toEqual(ts);
      expect(ts.length).toBeGreaterThan(2);
    }
  });
});
