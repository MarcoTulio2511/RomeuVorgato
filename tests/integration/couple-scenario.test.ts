import { describe, expect, it } from 'vitest';
import { invoiceTotals } from '../../src/domain/invoices/invoices';
import { DEFAULT_PREFERENCES, buildSnapshot, type HouseholdData } from '../../src/domain/snapshot';
import { ANA, BRU, account, budget, card, category, invoice, plan, planned, tx } from '../helpers/factories';

/**
 * Cenário integrado do casal. Todos os valores esperados foram calculados À MÃO a partir do enunciado
 * (não derivados do código): saldo, fatura, limite, orçamento, consolidado sem duplicar compartilhadas,
 * dinheiro livre sem contar duas vezes o que já foi efetivado.
 */
const TODAY = '2026-03-10';
const A1 = account({ id: 'A1', ownerId: ANA, initialBalanceCents: 500_000 });
const B1 = account({ id: 'B1', ownerId: BRU, initialBalanceCents: 200_000 });
const C1 = card({
  id: 'C1',
  ownerId: ANA,
  limitCents: 600_000,
  closingDay: 25,
  dueDay: 5,
  payAccountId: 'A1',
});
const mercado = category({ id: 'mercado', name: 'Mercado' });
const compras = category({ id: 'compras', name: 'Compras' });
const moradia = category({ id: 'moradia', name: 'Moradia' });

const I1 = invoice({
  id: 'I1',
  cardId: 'C1',
  cycleStart: '2026-02-25',
  cycleEnd: '2026-03-24',
  closingDate: '2026-03-25',
  dueDate: '2026-04-05',
});
const I2 = invoice({
  id: 'I2',
  cardId: 'C1',
  cycleStart: '2026-03-25',
  cycleEnd: '2026-04-24',
  closingDate: '2026-04-25',
  dueDate: '2026-05-05',
});
const I3 = invoice({
  id: 'I3',
  cardId: 'C1',
  cycleStart: '2026-04-25',
  cycleEnd: '2026-05-24',
  closingDate: '2026-05-25',
  dueDate: '2026-06-05',
});
const P1 = plan({
  id: 'P1',
  cardId: 'C1',
  totalCents: 90_000,
  installmentCount: 3,
  purchaseDate: '2026-03-04',
  categoryId: 'compras',
  ownerId: ANA,
});

const parcel = (n: number, inv: string, date: string) =>
  tx({
    id: `parc${n}`,
    type: 'card_purchase',
    amountCents: 30_000,
    cardId: 'C1',
    invoiceId: inv,
    occurredOn: date,
    categoryId: 'compras',
    ownerId: ANA,
    installmentPlanId: 'P1',
    installmentNumber: n,
  });

const baseTxs = [
  tx({
    id: 'sal-ana',
    type: 'income',
    amountCents: 800_000,
    accountId: 'A1',
    occurredOn: '2026-03-05',
    ownerId: ANA,
  }),
  tx({
    id: 'sal-bru',
    type: 'income',
    amountCents: 450_000,
    accountId: 'B1',
    occurredOn: '2026-03-05',
    ownerId: BRU,
  }),
  tx({
    id: 'aluguel',
    type: 'expense',
    amountCents: 150_000,
    accountId: 'A1',
    occurredOn: '2026-03-02',
    ownerId: ANA,
    scope: 'shared',
    categoryId: 'moradia',
  }),
  tx({
    id: 'bru-gasto',
    type: 'expense',
    amountCents: 20_000,
    accountId: 'B1',
    occurredOn: '2026-03-08',
    ownerId: BRU,
  }),
  tx({
    id: 'tr-out',
    type: 'transfer_out',
    amountCents: 50_000,
    accountId: 'A1',
    occurredOn: '2026-03-06',
    ownerId: ANA,
    transferGroupId: 'g1',
  }),
  tx({
    id: 'tr-in',
    type: 'transfer_in',
    amountCents: 50_000,
    accountId: 'B1',
    occurredOn: '2026-03-06',
    ownerId: BRU,
    transferGroupId: 'g1',
  }),
  tx({
    id: 'mercado',
    type: 'card_purchase',
    amountCents: 120_000,
    cardId: 'C1',
    invoiceId: 'I1',
    occurredOn: '2026-03-03',
    categoryId: 'mercado',
    ownerId: ANA,
    scope: 'shared',
  }),
  tx({
    id: 'estorno',
    type: 'card_refund',
    amountCents: 10_000,
    cardId: 'C1',
    invoiceId: 'I1',
    occurredOn: '2026-03-07',
    categoryId: 'mercado',
    ownerId: ANA,
  }),
  parcel(1, 'I1', '2026-03-04'),
  parcel(2, 'I2', '2026-04-04'),
  parcel(3, 'I3', '2026-05-04'),
];

const internet = tx({
  id: 'internet',
  type: 'expense',
  amountCents: 12_000,
  accountId: 'B1',
  occurredOn: '2026-03-09',
  ownerId: BRU,
  scope: 'shared',
});

function data(extraTxs = baseTxs, over: Partial<HouseholdData> = {}): HouseholdData {
  return {
    currentUserId: ANA,
    accounts: [A1, B1],
    cards: [C1],
    categories: [mercado, compras, moradia],
    transactions: extraTxs,
    invoices: [I1, I2, I3],
    plans: [P1],
    budgets: [budget({ id: 'bud', categoryId: 'mercado', ownerId: null, limitCents: 100_000 })],
    recurring: [],
    planned: [],
    prefs: DEFAULT_PREFERENCES,
    savingsGoalCents: null,
    ...over,
  };
}

describe('cenário do casal — consistência entre contas, cartão, fatura, parcelas e transações', () => {
  const joint = buildSnapshot(data(), TODAY, { kind: 'joint' });

  it('saldos por conta e consolidado (transferência interna não altera o total)', () => {
    const byId = Object.fromEntries(joint.accountBalances.map((b) => [b.account.id, b.balanceCents]));
    expect(byId).toEqual({ A1: 1_100_000, B1: 680_000 }); // 500+800−150−50 ; 200+450−20+50 (em R$ mil)
    expect(joint.consolidatedCents).toBe(1_780_000);
  });

  it('compras no cartão NÃO afetaram nenhum saldo bancário', () => {
    const withoutCard = buildSnapshot(data(baseTxs.filter((t) => !t.cardId)), TODAY, { kind: 'joint' });
    expect(withoutCard.consolidatedCents).toBe(joint.consolidatedCents);
  });

  it('fatura, parcelas e limite fecham: soma das parcelas == total do plano', () => {
    const t1 = invoiceTotals(I1, baseTxs);
    expect(t1).toMatchObject({
      purchasesCents: 150_000,
      refundsCents: 10_000,
      totalCents: 140_000,
      outstandingCents: 140_000,
    });
    expect(invoiceTotals(I2, baseTxs).totalCents).toBe(30_000);
    const parcels = baseTxs.filter((t) => t.installmentPlanId === 'P1');
    expect(parcels.reduce((a, t) => a + t.amountCents, 0)).toBe(P1.totalCents);
    const pos = joint.cards[0]!.position;
    expect(pos).toMatchObject({ usedCents: 200_000, availableCents: 400_000 }); // 140 + 30 + 30 mil; parcelas futuras consomem limite
  });

  it('despesas do mês: compra do cartão + 1ª parcela (não o parcelamento inteiro), estorno desconta, sem duplicar compartilhada', () => {
    // 150.000 aluguel + 20.000 + 120.000 mercado + 30.000 parcela 1 − 10.000 estorno
    expect(joint.month.totals).toEqual({ incomeCents: 1_250_000, expenseCents: 310_000, netCents: 940_000 });
    expect(joint.month.shared.expenseCents).toBe(270_000); // aluguel + mercado − (estorno é individual→ 0) → 150+120 = 270
  });

  it('visão individual + individual do parceiro = visão conjunta (nenhum valor perdido ou duplicado)', () => {
    const ana = buildSnapshot(data(), TODAY, { kind: 'person', userId: ANA });
    const bru = buildSnapshot(data(), TODAY, { kind: 'person', userId: BRU });
    expect(ana.month.totals.expenseCents + bru.month.totals.expenseCents).toBe(
      joint.month.totals.expenseCents,
    );
    expect(ana.month.totals.incomeCents + bru.month.totals.incomeCents).toBe(joint.month.totals.incomeCents);
    expect(ana.consolidatedCents + bru.consolidatedCents).toBe(joint.consolidatedCents);
    expect(bru.cards).toHaveLength(0);
  });

  it('orçamento de Mercado (compartilhado): 120.000 − 10.000 de estorno = 110.000 usados, estourado em 10.000', () => {
    const v = joint.budgetViews[0]!;
    expect(v.usage).toMatchObject({
      spentCents: 110_000,
      remainingCents: -10_000,
      overCents: 10_000,
      status: 'exceeded',
    });
    expect(joint.messages[0]).toMatchObject({ ruleId: 'budget_exceeded', severity: 'critical' });
  });

  it('pagamento parcial da fatura: debita a conta, reduz o saldo da fatura e o limite usado, sem nova despesa', () => {
    const pay = tx({
      id: 'pay1',
      type: 'invoice_payment',
      amountCents: 40_000,
      accountId: 'A1',
      cardId: 'C1',
      invoiceId: 'I1',
      occurredOn: '2026-03-09',
      ownerId: ANA,
    });
    const s = buildSnapshot(data([...baseTxs, pay]), TODAY, { kind: 'joint' });
    expect(s.accountBalances.find((b) => b.account.id === 'A1')!.balanceCents).toBe(1_060_000);
    expect(invoiceTotals(I1, [...baseTxs, pay])).toMatchObject({
      outstandingCents: 100_000,
      paidCents: 40_000,
    });
    expect(s.cards[0]!.position.usedCents).toBe(160_000);
    expect(s.month.totals.expenseCents).toBe(310_000); // pagamento não é despesa
  });

  it('dinheiro livre: não conta duas vezes o previsto já efetivado e desconta a fatura que vence antes do salário', () => {
    const pay = tx({
      id: 'pay1',
      type: 'invoice_payment',
      amountCents: 40_000,
      accountId: 'A1',
      cardId: 'C1',
      invoiceId: 'I1',
      occurredOn: '2026-03-09',
      ownerId: ANA,
    });
    const planneds = [
      planned({
        id: 'salario',
        type: 'income',
        amountCents: 800_000,
        dueDate: '2026-04-05',
        isCertain: true,
        isPrimaryIncome: true,
        ownerId: ANA,
        accountId: 'A1',
      }),
      planned({
        id: 'aluguel-abr',
        type: 'expense',
        amountCents: 150_000,
        dueDate: '2026-04-02',
        ownerId: ANA,
        accountId: 'A1',
      }),
      // já efetivado em 09/03 (lançamento 'internet'): tem de sair do previsto
      planned({
        id: 'net',
        type: 'expense',
        amountCents: 12_000,
        dueDate: '2026-03-09',
        status: 'realized',
        transactionId: 'internet',
        ownerId: BRU,
        accountId: 'B1',
      }),
      planned({
        id: 'net-prox',
        type: 'expense',
        amountCents: 12_000,
        dueDate: '2026-04-09',
        ownerId: BRU,
        accountId: 'B1',
      }), // depois do horizonte
    ];
    const s = buildSnapshot(data([...baseTxs, pay, internet], { planned: planneds }), TODAY, {
      kind: 'joint',
    });
    expect(s.horizon).toEqual({ date: '2026-04-05', reason: 'next_income' });
    // saldo: A1 1.060.000 + B1 668.000 = 1.728.000 ; + salário 800.000 − fatura I1 (100.000) − aluguel abr (150.000)
    expect(s.freeCash.bankBalanceCents).toBe(1_728_000);
    expect(s.freeCash.guaranteedFreeCents).toBe(2_278_000);
    expect(s.freeCash.commitments.map((c) => [c.label, c.amountCents])).toEqual([
      ['Previsto', 150_000],
      ['Fatura Cartão', 100_000],
    ]);
    expect(s.freeCash.isComplete).toBe(true);
  });

  it('sem dados completos o dinheiro livre é uma estimativa incompleta, não saldo garantido', () => {
    const s = buildSnapshot(data(baseTxs), TODAY, { kind: 'joint' });
    expect(s.freeCash.isComplete).toBe(false);
    expect(s.freeCash.assumptions.join(' ')).toMatch(/Nenhuma despesa prevista/);
  });
});
