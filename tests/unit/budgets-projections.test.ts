import { describe, expect, it } from 'vitest';
import { budgetUsage, categoryFamily, ordersThatFit } from '../../src/domain/budgets/budgets';
import { spendingEvents, type SpendingContext } from '../../src/domain/budgets/spending';
import { cashTimeline, defaultHorizon, freeCash } from '../../src/domain/projections/freeCash';
import { account, budget, card, category, invoice, plan, planned, tx } from '../helpers/factories';

const ctx = (over: Partial<SpendingContext> = {}): SpendingContext => ({
  invoices: [],
  plans: [],
  basis: 'competence',
  installmentPolicy: 'parcel',
  ...over,
});

describe('orçamento mensal por categoria', () => {
  const food = category({ id: 'food' });
  const sub = category({ id: 'ifood', parentId: 'food' });
  const other = category({ id: 'lazer' });
  const cats = [food, sub, other];
  const b = budget({ categoryId: 'food', limitCents: 40_000 });

  const txs = [
    tx({
      type: 'expense',
      amountCents: 15_000,
      categoryId: 'food',
      accountId: 'a',
      occurredOn: '2026-03-02',
    }),
    tx({
      type: 'card_purchase',
      amountCents: 12_000,
      categoryId: 'ifood',
      cardId: 'c',
      occurredOn: '2026-03-05',
    }),
    tx({ type: 'refund', amountCents: 2_000, categoryId: 'food', accountId: 'a', occurredOn: '2026-03-06' }),
    tx({
      type: 'expense',
      amountCents: 99_999,
      categoryId: 'food',
      accountId: 'a',
      occurredOn: '2026-02-28',
    }),
    tx({
      type: 'expense',
      amountCents: 50_000,
      categoryId: 'lazer',
      accountId: 'a',
      occurredOn: '2026-03-03',
    }),
    tx({ type: 'transfer_out', amountCents: 70_000, accountId: 'a', occurredOn: '2026-03-03' }),
    tx({
      type: 'invoice_payment',
      amountCents: 12_000,
      accountId: 'a',
      cardId: 'c',
      occurredOn: '2026-03-04',
    }),
  ];

  it('usado = gasto líquido (estorno reduz); subcategorias contam; transferências e pagamento de fatura não', () => {
    const u = budgetUsage(b, spendingEvents(txs, ctx()), cats, '2026-03', '2026-03-31');
    expect(u.spentCents).toBe(25_000);
    expect(u.remainingCents).toBe(15_000);
    expect(u.status).toBe('healthy');
    expect(u.lines).toHaveLength(3); // o valor é explicável linha a linha
  });

  it('alerta a partir do percentual configurado e excedido acima do limite', () => {
    const more = (cents: number) =>
      tx({
        type: 'expense',
        amountCents: cents,
        categoryId: 'food',
        accountId: 'a',
        occurredOn: '2026-03-09',
      });
    const warn = budgetUsage(b, spendingEvents([...txs, more(7_000)], ctx()), cats, '2026-03', '2026-03-31');
    expect(warn.spentCents).toBe(32_000);
    expect(warn.status).toBe('warning');
    const over = budgetUsage(b, spendingEvents([...txs, more(16_000)], ctx()), cats, '2026-03', '2026-03-31');
    expect(over).toMatchObject({
      spentCents: 41_000,
      remainingCents: -1_000,
      overCents: 1_000,
      status: 'exceeded',
    });
  });

  it('exatamente no limite ainda não é "excedido"', () => {
    const e = tx({
      type: 'expense',
      amountCents: 40_000,
      categoryId: 'food',
      accountId: 'a',
      occurredOn: '2026-03-09',
    });
    expect(budgetUsage(b, spendingEvents([e], ctx()), cats, '2026-03', '2026-03-31').status).toBe('warning');
  });

  it('projeção linear só com dias suficientes no mês corrente', () => {
    const ev = spendingEvents(txs, ctx());
    const mid = budgetUsage(b, ev, cats, '2026-03', '2026-03-10');
    expect(mid.projectedCents).toBe(77_500); // 25000/10 dias × 31
    expect(mid.willExceed).toBe(true);
    expect(budgetUsage(b, ev, cats, '2026-03', '2026-03-04').projectedCents).toBeNull();
    expect(budgetUsage(b, ev, cats, '2026-03', '2026-04-15').projectedCents).toBe(25_000); // mês encerrado
  });

  it('orçamento pessoal só conta o titular; compartilhado conta todos', () => {
    const mine = tx({
      type: 'expense',
      amountCents: 1_000,
      categoryId: 'food',
      ownerId: 'u1',
      occurredOn: '2026-03-02',
    });
    const theirs = tx({
      type: 'expense',
      amountCents: 4_000,
      categoryId: 'food',
      ownerId: 'u2',
      occurredOn: '2026-03-02',
    });
    const ev = spendingEvents([mine, theirs], ctx());
    expect(
      budgetUsage(budget({ categoryId: 'food', ownerId: 'u1' }), ev, cats, '2026-03', '2026-03-31')
        .spentCents,
    ).toBe(1_000);
    expect(
      budgetUsage(budget({ categoryId: 'food', ownerId: null }), ev, cats, '2026-03', '2026-03-31')
        .spentCents,
    ).toBe(5_000);
  });

  it('categoryFamily inclui netos', () => {
    const grand = category({ id: 'g', parentId: 'ifood' });
    expect([...categoryFamily([food, sub, grand, other], 'food')].sort()).toEqual(['food', 'g', 'ifood']);
  });

  it('base fatura: compra de cartão conta no mês de vencimento da fatura', () => {
    const inv = invoice({ id: 'I1', dueDate: '2026-04-05' });
    const t = tx({
      type: 'card_purchase',
      amountCents: 8_000,
      categoryId: 'food',
      cardId: 'c',
      invoiceId: 'I1',
      occurredOn: '2026-03-10',
    });
    const ev = spendingEvents([t], ctx({ invoices: [inv], basis: 'invoice' }));
    const bi = budget({ categoryId: 'food', basis: 'invoice' });
    expect(budgetUsage(bi, ev, cats, '2026-03', '2026-04-30').spentCents).toBe(0);
    expect(budgetUsage(bi, ev, cats, '2026-04', '2026-04-30').spentCents).toBe(8_000);
  });
});

describe('parcelamentos em relatórios: nunca compra integral + parcelas', () => {
  const p = plan({ id: 'P', totalCents: 30_000, installmentCount: 3, purchaseDate: '2026-03-10' });
  const parcels = [1, 2, 3].map((n) =>
    tx({
      type: 'card_purchase',
      amountCents: 10_000,
      cardId: 'c',
      installmentPlanId: 'P',
      installmentNumber: n,
      occurredOn: `2026-0${2 + n}-10`,
      categoryId: 'x',
    }),
  );

  it('política por parcela: reconhece cada parcela no seu mês', () => {
    const ev = spendingEvents(parcels, ctx({ plans: [p] }));
    expect(ev.map((e) => [e.date, e.amountCents])).toEqual([
      ['2026-03-10', 10_000],
      ['2026-04-10', 10_000],
      ['2026-05-10', 10_000],
    ]);
  });

  it('política por compra: total uma vez, na data da compra', () => {
    const ev = spendingEvents(parcels, ctx({ plans: [p], installmentPolicy: 'purchase' }));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ date: '2026-03-10', amountCents: 30_000 });
  });

  it('em ambas as políticas o total reconhecido é o mesmo (30.000)', () => {
    const sum = (policy: 'parcel' | 'purchase') =>
      spendingEvents(parcels, ctx({ plans: [p], installmentPolicy: policy })).reduce(
        (a, e) => a + e.amountCents,
        0,
      );
    expect(sum('parcel')).toBe(30_000);
    expect(sum('purchase')).toBe(30_000);
  });
});

describe('limite por pedido (ex.: iFood)', () => {
  it('não esconde a sobra nem sugere pedido que estoure o restante', () => {
    expect(ordersThatFit(5_000, 4_000)).toEqual({
      guaranteedOrders: 1,
      leftoverCents: 1_000,
      nextOrderMaxCents: 4_000,
    });
    expect(ordersThatFit(3_000, 4_000)).toEqual({
      guaranteedOrders: 0,
      leftoverCents: 3_000,
      nextOrderMaxCents: 3_000,
    });
    expect(ordersThatFit(40_000, 4_000)).toEqual({
      guaranteedOrders: 10,
      leftoverCents: 0,
      nextOrderMaxCents: 4_000,
    });
    expect(ordersThatFit(-100, 4_000)).toEqual({
      guaranteedOrders: 0,
      leftoverCents: 0,
      nextOrderMaxCents: 0,
    });
  });
});

describe('dinheiro livre', () => {
  const acc = account({ id: 'A', initialBalanceCents: 200_000, balanceDate: '2026-01-01' });
  const c = card({ id: 'C', closingDay: 25, dueDay: 5 });
  const today = '2026-03-10';
  const horizon = '2026-04-05';
  const base = {
    today,
    horizon,
    accounts: [acc],
    cards: [c],
    txs: [],
    invoices: [] as ReturnType<typeof invoice>[],
  };

  it('saldo bancário não é dinheiro livre: desconta fatura e despesas previstas, soma receitas confirmadas', () => {
    const inv = invoice({ id: 'I', cardId: 'C', dueDate: '2026-04-05' });
    const txs = [
      tx({
        type: 'card_purchase',
        amountCents: 50_000,
        cardId: 'C',
        invoiceId: 'I',
        occurredOn: '2026-03-01',
      }),
    ];
    const r = freeCash({
      ...base,
      invoices: [inv],
      txs,
      planned: [
        planned({ type: 'expense', amountCents: 30_000, dueDate: '2026-03-20' }),
        planned({ type: 'expense', amountCents: 99_999, dueDate: '2026-04-20' }), // depois do horizonte
        planned({ type: 'income', amountCents: 400_000, dueDate: '2026-04-05', isCertain: true }),
        planned({ type: 'income', amountCents: 100_000, dueDate: '2026-03-30', isCertain: false }),
      ],
    });
    expect(r.bankBalanceCents).toBe(200_000);
    expect(r.commitmentsCents).toBe(80_000);
    expect(r.guaranteedFreeCents).toBe(520_000); // 200000 + 400000 − 50000 − 30000
    expect(r.estimatedFreeCents).toBe(620_000);
    expect(r.assumptions.join(' ')).toMatch(/estimadas/);
  });

  it('previsto já efetivado (realized ou com lançamento vinculado) não é descontado de novo', () => {
    const real = tx({ type: 'expense', amountCents: 30_000, accountId: 'A', occurredOn: '2026-03-05' });
    const r = freeCash({
      ...base,
      txs: [real],
      planned: [
        planned({ type: 'expense', amountCents: 30_000, status: 'realized', transactionId: real.id }),
        planned({ type: 'expense', amountCents: 30_000, status: 'planned', transactionId: real.id }),
      ],
    });
    expect(r.bankBalanceCents).toBe(170_000);
    expect(r.commitmentsCents).toBe(0);
    expect(r.guaranteedFreeCents).toBe(170_000);
  });

  it('fatura que vence depois do horizonte não é descontada; vencida e em aberto, sim', () => {
    const later = invoice({ id: 'L', cardId: 'C', dueDate: '2026-05-05' });
    const overdue = invoice({ id: 'O', cardId: 'C', dueDate: '2026-03-01' });
    const txs = [
      tx({
        type: 'card_purchase',
        amountCents: 10_000,
        cardId: 'C',
        invoiceId: 'L',
        occurredOn: '2026-03-01',
      }),
      tx({
        type: 'card_purchase',
        amountCents: 7_000,
        cardId: 'C',
        invoiceId: 'O',
        occurredOn: '2026-02-01',
      }),
    ];
    const r = freeCash({ ...base, invoices: [later, overdue], txs, planned: [] });
    expect(r.commitmentsCents).toBe(7_000);
  });

  it('despesa prevista no cartão só desconta se a fatura vence até o horizonte', () => {
    const r = freeCash({
      ...base,
      planned: [
        planned({ type: 'expense', amountCents: 5_000, cardId: 'C', dueDate: '2026-03-12' }), // fatura vence 05/04
        planned({ type: 'expense', amountCents: 9_000, cardId: 'C', dueDate: '2026-03-28' }), // fatura vence 05/05
      ],
    });
    expect(r.commitmentsCents).toBe(5_000);
  });

  it('sem despesas previstas o resultado é marcado como estimativa incompleta', () => {
    const r = freeCash({ ...base, planned: [] });
    expect(r.isComplete).toBe(false);
    expect(r.assumptions.join(' ')).toMatch(/Nenhuma despesa prevista/);
  });

  it('receita atrasada e não lançada não entra como garantia', () => {
    const r = freeCash({
      ...base,
      planned: [planned({ type: 'income', amountCents: 50_000, dueDate: '2026-03-01' })],
    });
    expect(r.confirmedIncomeCents).toBe(0);
  });
});

describe('próximo salário (horizonte) e linha do tempo', () => {
  it('prioriza a renda principal; sem renda usa o fim do mês', () => {
    const list = [
      planned({ type: 'income', dueDate: '2026-03-15', isPrimaryIncome: false }),
      planned({ type: 'income', dueDate: '2026-03-20', isPrimaryIncome: true }),
    ];
    expect(defaultHorizon(list, '2026-03-10')).toEqual({ date: '2026-03-20', reason: 'next_income' });
    expect(defaultHorizon([], '2026-02-10')).toEqual({ date: '2026-02-28', reason: 'end_of_month' });
    expect(defaultHorizon([planned({ type: 'income', dueDate: '2026-03-10' })], '2026-03-10').reason).toBe(
      'end_of_month',
    );
  });

  it('linha do tempo acumula eventos em ordem e separa garantido de estimado', () => {
    const acc = account({ id: 'A', initialBalanceCents: 100_000 });
    const pts = cashTimeline({
      today: '2026-03-10',
      horizon: '2026-03-31',
      accounts: [acc],
      cards: [],
      invoices: [],
      txs: [],
      planned: [
        planned({ type: 'expense', amountCents: 20_000, dueDate: '2026-03-15' }),
        planned({ type: 'income', amountCents: 50_000, dueDate: '2026-03-20', isCertain: false }),
        planned({ type: 'income', amountCents: 300_000, dueDate: '2026-03-25', isCertain: true }),
      ],
    });
    expect(pts.map((p) => [p.date, p.guaranteedCents, p.estimatedCents])).toEqual([
      ['2026-03-10', 100_000, 100_000],
      ['2026-03-15', 80_000, 80_000],
      ['2026-03-20', 80_000, 130_000],
      ['2026-03-25', 380_000, 430_000],
    ]);
  });
});
