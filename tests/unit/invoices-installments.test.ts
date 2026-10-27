import { describe, expect, it } from 'vitest';
import { buildInstallmentSchedule } from '../../src/domain/installments/installments';
import {
  CardConfigError,
  cardPosition,
  closingDateFor,
  invoiceCycleFor,
  invoiceStatus,
  invoiceTotals,
} from '../../src/domain/invoices/invoices';
import { MoneyError } from '../../src/domain/money/money';
import { card, invoice, tx } from '../helpers/factories';

describe('ciclo da fatura (fecha dia 25, vence dia 5)', () => {
  const c = card({ closingDay: 25, dueDay: 5 });

  it('compra antes do fechamento cai na fatura que fecha no mês; vence no mês seguinte', () => {
    expect(invoiceCycleFor(c, '2026-03-10')).toEqual({
      cycleStart: '2026-02-25',
      cycleEnd: '2026-03-24',
      closingDate: '2026-03-25',
      dueDate: '2026-04-05',
    });
  });

  it('compra NO dia do fechamento: regra "next" (padrão) vai para a fatura seguinte', () => {
    expect(closingDateFor(c, '2026-03-25')).toBe('2026-04-25');
    expect(closingDateFor(c, '2026-03-24')).toBe('2026-03-25');
    expect(closingDateFor(c, '2026-03-26')).toBe('2026-04-25');
  });

  it('compra NO dia do fechamento: regra "current" fica na fatura que fecha naquele dia', () => {
    const cur = card({ closingDay: 25, dueDay: 5, closingDayRule: 'current' });
    expect(invoiceCycleFor(cur, '2026-03-25')).toEqual({
      cycleStart: '2026-02-26',
      cycleEnd: '2026-03-25',
      closingDate: '2026-03-25',
      dueDate: '2026-04-05',
    });
    expect(closingDateFor(cur, '2026-03-26')).toBe('2026-04-25');
  });

  it('virada de ano', () => {
    expect(invoiceCycleFor(c, '2026-12-30')).toMatchObject({
      closingDate: '2027-01-25',
      dueDate: '2027-02-05',
    });
  });

  it('vencimento no mesmo mês quando dueDay > closingDay', () => {
    const c2 = card({ closingDay: 3, dueDay: 10 });
    expect(invoiceCycleFor(c2, '2026-03-01')).toMatchObject({
      closingDate: '2026-03-03',
      dueDate: '2026-03-10',
    });
    expect(invoiceCycleFor(c2, '2026-03-03')).toMatchObject({
      closingDate: '2026-04-03',
      dueDate: '2026-04-10',
    });
  });

  it('fechamento no dia 31 em mês curto', () => {
    const c3 = card({ closingDay: 31, dueDay: 10 });
    expect(invoiceCycleFor(c3, '2026-02-15')).toEqual({
      cycleStart: '2026-01-31',
      cycleEnd: '2026-02-27',
      closingDate: '2026-02-28',
      dueDate: '2026-03-10',
    });
    // compra no dia 28/02 (fechamento real) vai para março; ciclo de março começa em 28/02
    expect(invoiceCycleFor(c3, '2026-02-28')).toMatchObject({
      cycleStart: '2026-02-28',
      closingDate: '2026-03-31',
    });
  });

  it('exige dias válidos', () => {
    expect(() => closingDateFor(card({ closingDay: 0 }), '2026-03-10')).toThrow(CardConfigError);
    expect(() => closingDateFor(card({ dueDay: 32 }), '2026-03-10')).toThrow(CardConfigError);
  });
});

describe('total, pagamentos parciais e status da fatura', () => {
  const inv = invoice({ id: 'I1', cycleEnd: '2026-03-24', dueDate: '2026-04-05' });
  const base = [
    tx({ type: 'card_purchase', amountCents: 30_000, invoiceId: 'I1', cardId: 'c' }),
    tx({ type: 'card_purchase', amountCents: 20_000, invoiceId: 'I1', cardId: 'c' }),
    tx({ type: 'card_fee', amountCents: 1_000, invoiceId: 'I1', cardId: 'c' }),
    tx({ type: 'card_refund', amountCents: 5_000, invoiceId: 'I1', cardId: 'c' }),
    tx({ type: 'card_purchase', amountCents: 777, invoiceId: 'OUTRA', cardId: 'c' }),
    tx({ type: 'card_purchase', amountCents: 888, invoiceId: 'I1', cardId: 'c', status: 'cancelled' }),
  ];

  it('total = compras + encargos − estornos (ignora cancelados e outras faturas)', () => {
    const t = invoiceTotals(inv, base);
    expect(t).toMatchObject({
      purchasesCents: 50_000,
      feesCents: 1_000,
      refundsCents: 5_000,
      totalCents: 46_000,
      paidCents: 0,
      outstandingCents: 46_000,
    });
  });

  it('compras pendentes não compõem o total da fatura', () => {
    const t = invoiceTotals(inv, [
      ...base,
      tx({ type: 'card_purchase', amountCents: 9_000, invoiceId: 'I1', status: 'pending' }),
    ]);
    expect(t.totalCents).toBe(46_000);
    expect(t.pendingCents).toBe(9_000);
  });

  it('pagamento parcial reduz o saldo mas NÃO quita a fatura', () => {
    const pay = tx({
      type: 'invoice_payment',
      amountCents: 10_000,
      invoiceId: 'I1',
      accountId: 'a',
      cardId: 'c',
    });
    const t = invoiceTotals(inv, [...base, pay]);
    expect(t).toMatchObject({ totalCents: 46_000, paidCents: 10_000, outstandingCents: 36_000 });
    expect(invoiceStatus(inv, t, '2026-04-01')).toBe('partially_paid');
    expect(invoiceStatus(inv, t, '2026-04-06')).toBe('overdue'); // restante vencido
  });

  it('paga integralmente em dois pagamentos', () => {
    const pays = [
      tx({ type: 'invoice_payment', amountCents: 10_000, invoiceId: 'I1', accountId: 'a' }),
      tx({ type: 'invoice_payment', amountCents: 36_000, invoiceId: 'I1', accountId: 'a' }),
    ];
    const t = invoiceTotals(inv, [...base, ...pays]);
    expect(t.outstandingCents).toBe(0);
    expect(invoiceStatus(inv, t, '2026-04-06')).toBe('paid');
  });

  it('estados: aberta até o fim do ciclo, depois fechada, depois vencida', () => {
    const t = invoiceTotals(inv, base);
    expect(invoiceStatus(inv, t, '2026-03-24')).toBe('open');
    expect(invoiceStatus(inv, t, '2026-03-25')).toBe('closed');
    expect(invoiceStatus(inv, t, '2026-04-05')).toBe('closed');
    expect(invoiceStatus(inv, t, '2026-04-06')).toBe('overdue');
  });
});

describe('limite disponível', () => {
  const c = card({ id: 'c', limitCents: 500_000 });
  const i1 = invoice({ id: 'I1', cardId: 'c' });
  const i2 = invoice({ id: 'I2', cardId: 'c', closingDate: '2026-04-25', dueDate: '2026-05-05' });

  it('desconta o que ainda não foi liberado por pagamento, sem subtrair duas vezes', () => {
    const txs = [
      tx({ type: 'card_purchase', amountCents: 46_000, invoiceId: 'I1', cardId: 'c' }),
      tx({ type: 'card_purchase', amountCents: 20_000, invoiceId: 'I2', cardId: 'c' }),
      tx({ type: 'invoice_payment', amountCents: 10_000, invoiceId: 'I1', accountId: 'a', cardId: 'c' }),
    ];
    expect(cardPosition(c, [i1, i2], txs)).toMatchObject({ usedCents: 56_000, availableCents: 444_000 });
  });

  it('compras pendentes consomem limite; estorno libera', () => {
    const txs = [
      tx({ type: 'card_purchase', amountCents: 40_000, invoiceId: 'I1', cardId: 'c' }),
      tx({ type: 'card_refund', amountCents: 10_000, invoiceId: 'I1', cardId: 'c' }),
      tx({ type: 'card_purchase', amountCents: 7_000, invoiceId: 'I1', cardId: 'c', status: 'pending' }),
    ];
    const p = cardPosition(c, [i1], txs);
    expect(p.usedCents).toBe(37_000);
    expect(p.pendingCents).toBe(7_000);
  });

  it('fatura quitada libera todo o limite; crédito excedente não cria limite extra', () => {
    const paid = [
      tx({ type: 'card_purchase', amountCents: 10_000, invoiceId: 'I1', cardId: 'c' }),
      tx({ type: 'invoice_payment', amountCents: 10_000, invoiceId: 'I1', accountId: 'a', cardId: 'c' }),
    ];
    expect(cardPosition(c, [i1], paid).availableCents).toBe(500_000);
    const credit = [tx({ type: 'card_refund', amountCents: 3_000, invoiceId: 'I1', cardId: 'c' })];
    expect(cardPosition(c, [i1], credit).availableCents).toBe(500_000);
  });
});

describe('compras parceladas', () => {
  const c = card({ closingDay: 25, dueDay: 5 });

  it('R$ 100,00 em 3x preserva o total e distribui o centavo restante', () => {
    const s = buildInstallmentSchedule(c, '2026-03-10', 10_000, 3);
    expect(s.map((x) => x.amountCents)).toEqual([3_334, 3_333, 3_333]);
    expect(s.reduce((a, x) => a + x.amountCents, 0)).toBe(10_000);
  });

  it('cada parcela cai no ciclo correspondente (virada de ano)', () => {
    const s = buildInstallmentSchedule(c, '2026-11-10', 30_000, 3);
    expect(s.map((x) => x.invoice.closingDate)).toEqual(['2026-11-25', '2026-12-25', '2027-01-25']);
    expect(s.map((x) => x.invoice.dueDate)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
    expect(s.map((x) => x.competenceDate)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10']);
  });

  it('compra parcelada feita no fechamento começa na fatura seguinte', () => {
    const s = buildInstallmentSchedule(c, '2026-03-25', 20_000, 2);
    expect(s.map((x) => x.invoice.closingDate)).toEqual(['2026-04-25', '2026-05-25']);
  });

  it('competência em meses curtos', () => {
    const s = buildInstallmentSchedule(c, '2026-01-31', 9_000, 3);
    expect(s.map((x) => x.competenceDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('rejeita parcelamentos inválidos', () => {
    expect(() => buildInstallmentSchedule(c, '2026-03-10', 2, 3)).toThrow(MoneyError);
    expect(() => buildInstallmentSchedule(c, '2026-03-10', 1_000, 0)).toThrow(MoneyError);
    expect(() => buildInstallmentSchedule(c, '2026-03-10', 1_000, 49)).toThrow(MoneyError);
    expect(() => buildInstallmentSchedule(c, '2026-03-10', 0, 2)).toThrow(MoneyError);
  });

  it('é determinístico: recalcular dá exatamente o mesmo cronograma (sem parcelas duplicadas)', () => {
    const a = buildInstallmentSchedule(c, '2026-03-10', 12_345, 5);
    const b = buildInstallmentSchedule(c, '2026-03-10', 12_345, 5);
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => x.number)).size).toBe(5);
  });
});
