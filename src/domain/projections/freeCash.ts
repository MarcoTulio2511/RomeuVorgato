import { compareISO, diffDays, endOfMonth, type ISODate } from '../dates';
import { invoiceCycleFor, invoiceTotals } from '../invoices/invoices';
import { consolidatedBalance } from '../transactions/balances';
import type { Cents } from '../money/money';
import type { Account, CreditCard, Invoice, PlannedTransaction, Transaction } from '../types';

export interface Commitment {
  kind: 'invoice' | 'planned_expense' | 'planned_card_expense';
  label: string;
  dueDate: ISODate;
  amountCents: Cents;
  refId: string;
}

export interface FreeCashInput {
  today: ISODate;
  horizon: ISODate;
  accounts: readonly Account[];
  cards: readonly CreditCard[];
  invoices: readonly Invoice[];
  txs: readonly Transaction[];
  planned: readonly PlannedTransaction[];
}

export interface FreeCashResult {
  today: ISODate;
  horizon: ISODate;
  bankBalanceCents: Cents;
  confirmedIncomeCents: Cents;
  estimatedIncomeCents: Cents;
  commitmentsCents: Cents;
  commitments: Commitment[];
  /** Só com receitas confirmadas. Pode ser negativo (compromissos > dinheiro). */
  guaranteedFreeCents: Cents;
  /** Garantido + receitas estimadas. Nunca apresentar como saldo garantido. */
  estimatedFreeCents: Cents;
  isComplete: boolean;
  assumptions: string[];
}

/**
 * Dinheiro livre até `horizon` (inclusive):
 *   saldo das contas (visão conjunta)
 *   + receitas previstas ainda não efetivadas (confirmadas / estimadas)
 *   − faturas em aberto com vencimento até o horizon
 *   − despesas previstas ainda não efetivadas até o horizon.
 *
 * Anti-duplicidade: só entram previstos com status 'planned' (sem lançamento vinculado). Quando um
 * previsto é efetivado, o lançamento real passa a compor o saldo/fatura e o previsto sai da conta.
 * Compras futuras de cartão previstas só descontam se a fatura em que cairão vence até o horizon.
 */
export function freeCash(input: FreeCashInput): FreeCashResult {
  const { today, horizon, accounts, cards, invoices, txs, planned } = input;
  const bank = consolidatedBalance(accounts, txs, today);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const commitments: Commitment[] = [];

  for (const inv of invoices) {
    if (compareISO(inv.dueDate, horizon) > 0) continue;
    const t = invoiceTotals(inv, txs);
    if (t.outstandingCents <= 0) continue;
    const card = cardById.get(inv.cardId);
    commitments.push({
      kind: 'invoice',
      label: `Fatura ${card?.name ?? 'do cartão'}`,
      dueDate: inv.dueDate,
      amountCents: t.outstandingCents,
      refId: inv.id,
    });
  }

  let confirmed = 0;
  let estimated = 0;
  for (const p of planned) {
    if (p.status !== 'planned' || p.transactionId) continue; // já efetivado/ignorado: não conta de novo
    if (compareISO(p.dueDate, horizon) > 0) continue;
    if (p.type === 'income') {
      if (compareISO(p.dueDate, today) < 0) continue; // receita atrasada e não lançada não é garantia de entrada
      if (p.isCertain) confirmed += p.amountCents;
      else estimated += p.amountCents;
      continue;
    }
    const card = p.cardId ? cardById.get(p.cardId) : undefined;
    if (card) {
      const invDue = invoiceCycleFor(card, p.dueDate).dueDate;
      if (compareISO(invDue, horizon) > 0) continue; // cairá em fatura que vence depois do horizonte
      commitments.push({
        kind: 'planned_card_expense',
        label: p.description,
        dueDate: invDue,
        amountCents: p.amountCents,
        refId: p.id,
      });
    } else {
      commitments.push({
        kind: 'planned_expense',
        label: p.description,
        dueDate: p.dueDate,
        amountCents: p.amountCents,
        refId: p.id,
      });
    }
  }

  commitments.sort((a, b) => compareISO(a.dueDate, b.dueDate) || a.label.localeCompare(b.label));
  const commitmentsCents = commitments.reduce((acc, c) => acc + c.amountCents, 0);
  const guaranteed = bank + confirmed - commitmentsCents;

  const assumptions: string[] = [
    `Período: de hoje até ${horizon} (${diffDays(horizon, today)} dia(s)).`,
    'Saldo = contas ativas da visão conjunta; limites de cartão não contam como dinheiro.',
    'Faturas entram pelo saldo em aberto das que vencem até o fim do período.',
    'Gastos não cadastrados (compras do dia a dia) não são previstos.',
    'Feriados não são considerados no ajuste de datas.',
  ];
  const hasExpensePlan = planned.some((p) => p.type === 'expense');
  if (!hasExpensePlan)
    assumptions.push('Nenhuma despesa prevista cadastrada: o resultado pode estar otimista.');
  if (estimated > 0) assumptions.push('Inclui receitas estimadas, que não são garantidas.');
  if (accounts.filter((a) => a.isActive && a.includeInConsolidated).length === 0) {
    assumptions.push('Nenhuma conta na visão conjunta: saldo bancário é zero.');
  }

  return {
    today,
    horizon,
    bankBalanceCents: bank,
    confirmedIncomeCents: confirmed,
    estimatedIncomeCents: estimated,
    commitmentsCents,
    commitments,
    guaranteedFreeCents: guaranteed,
    estimatedFreeCents: guaranteed + estimated,
    isComplete: hasExpensePlan && accounts.some((a) => a.isActive && a.includeInConsolidated),
    assumptions,
  };
}

export interface Horizon {
  date: ISODate;
  reason: 'next_income' | 'end_of_month';
}

/** Próxima entrada de renda prevista (estritamente depois de hoje); sem ela, fim do mês. */
export function defaultHorizon(planned: readonly PlannedTransaction[], today: ISODate): Horizon {
  const incomes = planned
    .filter((p) => p.type === 'income' && p.status === 'planned' && compareISO(p.dueDate, today) > 0)
    .sort((a, b) => compareISO(a.dueDate, b.dueDate));
  const primary = incomes.find((p) => p.isPrimaryIncome);
  const pick = primary ?? incomes[0];
  return pick
    ? { date: pick.dueDate, reason: 'next_income' }
    : { date: endOfMonth(today), reason: 'end_of_month' };
}

export interface TimelinePoint {
  date: ISODate;
  guaranteedCents: Cents;
  estimatedCents: Cents;
  events: string[];
}

/** Saldo projetado nos dias com evento (receita prevista, despesa prevista ou vencimento de fatura). */
export function cashTimeline(input: FreeCashInput): TimelinePoint[] {
  const { today, horizon } = input;
  const base = consolidatedBalance(input.accounts, input.txs, today);
  const cardById = new Map(input.cards.map((c) => [c.id, c]));
  type Ev = { date: ISODate; delta: Cents; certain: boolean; label: string };
  const evs: Ev[] = [];

  for (const inv of input.invoices) {
    if (compareISO(inv.dueDate, horizon) > 0) continue;
    const t = invoiceTotals(inv, input.txs);
    if (t.outstandingCents <= 0) continue;
    const date = compareISO(inv.dueDate, today) < 0 ? today : inv.dueDate;
    evs.push({
      date,
      delta: -t.outstandingCents,
      certain: true,
      label: `Fatura ${cardById.get(inv.cardId)?.name ?? ''}`.trim(),
    });
  }
  for (const p of input.planned) {
    if (p.status !== 'planned' || p.transactionId || compareISO(p.dueDate, horizon) > 0) continue;
    if (p.type === 'income') {
      if (compareISO(p.dueDate, today) < 0) continue;
      evs.push({ date: p.dueDate, delta: p.amountCents, certain: p.isCertain, label: p.description });
      continue;
    }
    const card = p.cardId ? cardById.get(p.cardId) : undefined;
    const date = card
      ? invoiceCycleFor(card, p.dueDate).dueDate
      : compareISO(p.dueDate, today) < 0
        ? today
        : p.dueDate;
    if (compareISO(date, horizon) > 0) continue;
    evs.push({ date, delta: -p.amountCents, certain: true, label: p.description });
  }
  evs.sort((a, b) => compareISO(a.date, b.date));

  const points: TimelinePoint[] = [{ date: today, guaranteedCents: base, estimatedCents: base, events: [] }];
  let g = base;
  let e = base;
  for (const ev of evs) {
    e += ev.delta;
    if (ev.certain) g += ev.delta;
    const last = points[points.length - 1]!;
    if (last.date === ev.date) {
      last.guaranteedCents = g;
      last.estimatedCents = e;
      last.events.push(ev.label);
    } else {
      points.push({ date: ev.date, guaranteedCents: g, estimatedCents: e, events: [ev.label] });
    }
  }
  return points;
}
