import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  cashFlowTotals,
  consolidatedBalance,
  filterByView,
  periodTotals,
} from '../../src/domain/transactions/balances';
import { ANA, BRU, account, tx } from '../helpers/factories';

describe('saldo da conta', () => {
  const acc = account({ id: 'A', initialBalanceCents: 100_000, balanceDate: '2026-01-01' });

  it('soma receitas e subtrai despesas, transferências enviadas e pagamentos de fatura', () => {
    const txs = [
      tx({ type: 'income', amountCents: 50_000, accountId: 'A', occurredOn: '2026-02-01' }),
      tx({ type: 'expense', amountCents: 20_000, accountId: 'A', occurredOn: '2026-02-02' }),
      tx({ type: 'transfer_out', amountCents: 10_000, accountId: 'A', occurredOn: '2026-02-03' }),
      tx({
        type: 'invoice_payment',
        amountCents: 15_000,
        accountId: 'A',
        cardId: 'c',
        occurredOn: '2026-02-05',
      }),
      tx({ type: 'transfer_in', amountCents: 2_500, accountId: 'A', occurredOn: '2026-02-06' }),
    ];
    // 100000 + 50000 − 20000 − 10000 − 15000 + 2500
    expect(accountBalance(acc, txs, '2026-03-01')).toBe(107_500);
  });

  it('compras no cartão NÃO reduzem o saldo bancário até a fatura ser paga', () => {
    const purchase = tx({
      type: 'card_purchase',
      amountCents: 80_000,
      cardId: 'c',
      occurredOn: '2026-02-10',
    });
    expect(accountBalance(acc, [purchase], '2026-03-01')).toBe(100_000);
    const payment = tx({
      type: 'invoice_payment',
      amountCents: 80_000,
      accountId: 'A',
      cardId: 'c',
      occurredOn: '2026-03-05',
    });
    expect(accountBalance(acc, [purchase, payment], '2026-03-10')).toBe(20_000);
  });

  it('ignora movimentos anteriores à data-base, pendentes, cancelados e posteriores a asOf', () => {
    const txs = [
      tx({ type: 'expense', amountCents: 99_999, accountId: 'A', occurredOn: '2025-12-31' }),
      tx({
        type: 'expense',
        amountCents: 5_000,
        accountId: 'A',
        occurredOn: '2026-02-01',
        status: 'pending',
      }),
      tx({
        type: 'expense',
        amountCents: 6_000,
        accountId: 'A',
        occurredOn: '2026-02-01',
        status: 'cancelled',
      }),
      tx({ type: 'expense', amountCents: 7_000, accountId: 'A', occurredOn: '2026-06-01' }),
      tx({ type: 'expense', amountCents: 1_000, accountId: 'A', occurredOn: '2026-01-01' }), // mesmo dia da base conta
    ];
    expect(accountBalance(acc, txs, '2026-03-01')).toBe(99_000);
  });

  it('estorno em conta devolve o valor sem virar receita', () => {
    const txs = [
      tx({ type: 'expense', amountCents: 10_000, accountId: 'A', occurredOn: '2026-02-01' }),
      tx({ type: 'refund', amountCents: 10_000, accountId: 'A', occurredOn: '2026-02-05' }),
    ];
    expect(accountBalance(acc, txs, '2026-03-01')).toBe(100_000);
    expect(periodTotals(txs, '2026-02-01', '2026-02-28')).toMatchObject({ incomeCents: 0, expenseCents: 0 });
  });

  it('ajustes têm sinal próprio', () => {
    const txs = [
      tx({
        type: 'adjustment_in',
        amountCents: 300,
        accountId: 'A',
        occurredOn: '2026-02-01',
        notes: 'ajuste',
      }),
      tx({
        type: 'adjustment_out',
        amountCents: 100,
        accountId: 'A',
        occurredOn: '2026-02-02',
        notes: 'ajuste',
      }),
    ];
    expect(accountBalance(acc, txs, '2026-03-01')).toBe(100_200);
  });
});

describe('visão consolidada do casal', () => {
  const a = account({ id: 'A', ownerId: ANA, initialBalanceCents: 100_000 });
  const b = account({ id: 'B', ownerId: BRU, initialBalanceCents: 20_000 });
  const hidden = account({
    id: 'C',
    ownerId: BRU,
    initialBalanceCents: 999_999,
    includeInConsolidated: false,
  });
  const closed = account({ id: 'D', ownerId: BRU, initialBalanceCents: 555, isActive: false });

  it('transferência interna move saldo entre contas sem alterar o total consolidado', () => {
    const out = tx({
      type: 'transfer_out',
      amountCents: 30_000,
      accountId: 'A',
      transferGroupId: 'g',
      occurredOn: '2026-02-01',
    });
    const inn = tx({
      type: 'transfer_in',
      amountCents: 30_000,
      accountId: 'B',
      transferGroupId: 'g',
      occurredOn: '2026-02-01',
    });
    const accounts = [a, b, hidden, closed];
    expect(consolidatedBalance(accounts, [], '2026-03-01')).toBe(120_000);
    expect(consolidatedBalance(accounts, [out, inn], '2026-03-01')).toBe(120_000);
  });

  it('transferência não é receita nem despesa consolidada', () => {
    const out = tx({ type: 'transfer_out', amountCents: 30_000, accountId: 'A', occurredOn: '2026-02-01' });
    const inn = tx({ type: 'transfer_in', amountCents: 30_000, accountId: 'B', occurredOn: '2026-02-01' });
    expect(periodTotals([out, inn], '2026-02-01', '2026-02-28')).toEqual({
      incomeCents: 0,
      expenseCents: 0,
      netCents: 0,
    });
    expect(cashFlowTotals([out, inn], '2026-02-01', '2026-02-28')).toEqual({
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0,
    });
  });

  it('despesa compartilhada aparece uma única vez e fica na visão individual de quem pagou', () => {
    const shared = tx({
      type: 'expense',
      amountCents: 40_000,
      accountId: 'A',
      scope: 'shared',
      ownerId: ANA,
      occurredOn: '2026-02-10',
    });
    const mine = tx({
      type: 'expense',
      amountCents: 5_000,
      accountId: 'B',
      ownerId: BRU,
      occurredOn: '2026-02-11',
    });
    const all = [shared, mine];
    expect(periodTotals(all, '2026-02-01', '2026-02-28').expenseCents).toBe(45_000);
    expect(periodTotals(all, '2026-02-01', '2026-02-28', 'shared').expenseCents).toBe(40_000);
    expect(
      periodTotals(filterByView(all, { kind: 'person', userId: BRU }), '2026-02-01', '2026-02-28')
        .expenseCents,
    ).toBe(5_000);
  });

  it('cartão: despesa conta na compra; pagamento da fatura não duplica a despesa', () => {
    const purchase = tx({
      type: 'card_purchase',
      amountCents: 50_000,
      cardId: 'c',
      occurredOn: '2026-02-10',
    });
    const pay = tx({
      type: 'invoice_payment',
      amountCents: 50_000,
      accountId: 'A',
      cardId: 'c',
      occurredOn: '2026-03-05',
    });
    expect(periodTotals([purchase, pay], '2026-02-01', '2026-03-31').expenseCents).toBe(50_000);
    // fluxo de caixa (base caixa): sai no pagamento, não na compra
    expect(cashFlowTotals([purchase, pay], '2026-02-01', '2026-02-28').outflowCents).toBe(0);
    expect(cashFlowTotals([purchase, pay], '2026-03-01', '2026-03-31').outflowCents).toBe(50_000);
  });

  it('estorno no cartão reduz a despesa líquida', () => {
    const purchase = tx({
      type: 'card_purchase',
      amountCents: 50_000,
      cardId: 'c',
      occurredOn: '2026-02-10',
    });
    const refund = tx({ type: 'card_refund', amountCents: 12_000, cardId: 'c', occurredOn: '2026-02-12' });
    expect(periodTotals([purchase, refund], '2026-02-01', '2026-02-28').expenseCents).toBe(38_000);
  });
});
