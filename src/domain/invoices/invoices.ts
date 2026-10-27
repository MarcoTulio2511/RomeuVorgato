import { addDays, clampedDate, compareISO, parseISO, type ISODate } from '../dates';
import { assertCents, type Cents } from '../money/money';
import type { CreditCard, Invoice, Transaction } from '../types';

export interface InvoiceCycle {
  cycleStart: ISODate;
  cycleEnd: ISODate;
  closingDate: ISODate;
  dueDate: ISODate;
}

export class CardConfigError extends Error {}

export function validateCardDays(closingDay: number, dueDay: number): void {
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 31;
  if (!ok(closingDay) || !ok(dueDay)) {
    throw new CardConfigError('Informe os dias de fechamento e de vencimento (1 a 31).');
  }
}

type CycleCard = Pick<CreditCard, 'closingDay' | 'dueDay' | 'closingDayRule'>;

/** Data de fechamento do mês (y, m): dia configurado limitado ao último dia do mês. */
function closingIn(card: CycleCard, y: number, m: number): ISODate {
  return clampedDate(y, m, card.closingDay);
}

/**
 * Vencimento: primeiro `dueDay` ESTRITAMENTE depois do fechamento.
 * Ex.: fecha dia 25, vence dia 5 → vence no mês seguinte; fecha dia 3, vence dia 10 → mesmo mês.
 */
export function dueDateFor(card: CycleCard, closingDate: ISODate): ISODate {
  const { y, m } = parseISO(closingDate);
  const sameMonth = clampedDate(y, m, card.dueDay);
  return compareISO(sameMonth, closingDate) > 0 ? sameMonth : clampedDate(y, m + 1, card.dueDay);
}

/** Fecha a fatura cujo fechamento cai em `closingDate` (já é a data de fechamento real). */
export function cycleForClosing(card: CycleCard, closingDate: ISODate): InvoiceCycle {
  const { y, m } = parseISO(closingDate);
  const prevClosing = closingIn(card, y, m - 1);
  const cycleStart = card.closingDayRule === 'next' ? prevClosing : addDays(prevClosing, 1);
  const cycleEnd = card.closingDayRule === 'next' ? addDays(closingDate, -1) : closingDate;
  return { cycleStart, cycleEnd, closingDate, dueDate: dueDateFor(card, closingDate) };
}

/** Data de fechamento da fatura que recebe uma compra feita em `purchaseDate`. */
export function closingDateFor(card: CycleCard, purchaseDate: ISODate): ISODate {
  validateCardDays(card.closingDay, card.dueDay);
  const { y, m } = parseISO(purchaseDate);
  const thisClosing = closingIn(card, y, m);
  const stays =
    card.closingDayRule === 'next'
      ? compareISO(purchaseDate, thisClosing) < 0
      : compareISO(purchaseDate, thisClosing) <= 0;
  return stays ? thisClosing : closingIn(card, y, m + 1);
}

export function invoiceCycleFor(card: CycleCard, purchaseDate: ISODate): InvoiceCycle {
  return cycleForClosing(card, closingDateFor(card, purchaseDate));
}

/** Fechamento `offset` ciclos depois de `closingDate` (usado em parcelas). */
export function shiftClosing(card: CycleCard, closingDate: ISODate, offset: number): ISODate {
  const { y, m } = parseISO(closingDate);
  return closingIn(card, y, m + offset);
}

export type InvoiceStatus = 'open' | 'closed' | 'partially_paid' | 'paid' | 'overdue';

export interface InvoiceTotals {
  purchasesCents: Cents;
  feesCents: Cents;
  refundsCents: Cents;
  /** Total da fatura = compras + encargos − estornos/créditos. Não desconta pagamentos. */
  totalCents: Cents;
  paidCents: Cents;
  /** A pagar = total − pagamentos associados (pode ser negativo se houver crédito). */
  outstandingCents: Cents;
  pendingCents: Cents;
}

export function invoiceTotals(invoice: Pick<Invoice, 'id'>, txs: readonly Transaction[]): InvoiceTotals {
  let purchases = 0;
  let fees = 0;
  let refunds = 0;
  let paid = 0;
  let pending = 0;
  for (const t of txs) {
    if (t.invoiceId !== invoice.id || t.status === 'cancelled') continue;
    if (t.status === 'pending') {
      if (t.type === 'card_purchase') pending += t.amountCents;
      continue; // pendentes não compõem o total da fatura
    }
    switch (t.type) {
      case 'card_purchase':
        purchases += t.amountCents;
        break;
      case 'card_fee':
        fees += t.amountCents;
        break;
      case 'card_refund':
        refunds += t.amountCents;
        break;
      case 'invoice_payment':
        paid += t.amountCents;
        break;
      default:
        break;
    }
  }
  const total = assertCents(purchases + fees - refunds, 'total da fatura');
  return {
    purchasesCents: purchases,
    feesCents: fees,
    refundsCents: refunds,
    totalCents: total,
    paidCents: paid,
    outstandingCents: assertCents(total - paid, 'saldo da fatura'),
    pendingCents: pending,
  };
}

export function invoiceStatus(
  invoice: Pick<Invoice, 'cycleEnd' | 'dueDate'>,
  totals: InvoiceTotals,
  today: ISODate,
): InvoiceStatus {
  const closed = compareISO(today, invoice.cycleEnd) > 0;
  if (!closed) return 'open';
  if (totals.outstandingCents <= 0) return 'paid'; // inclui fatura zerada por créditos
  if (compareISO(today, invoice.dueDate) > 0) return 'overdue';
  return totals.paidCents > 0 ? 'partially_paid' : 'closed';
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  partially_paid: 'Paga parcialmente',
  paid: 'Paga',
  overdue: 'Vencida',
};

export interface CardPosition {
  limitCents: Cents;
  /** Consumo do limite = Σ saldo em aberto das faturas (inclui parcelas futuras) + compras pendentes. */
  usedCents: Cents;
  availableCents: Cents;
  pendingCents: Cents;
}

/**
 * Limite disponível = limite − (compras ainda não liberadas por pagamento).
 * Pagamentos já abatem `outstanding` da própria fatura, então nunca são subtraídos duas vezes.
 * Créditos acima do saldo não aumentam o limite além do total (saldo credor é limitado a 0).
 */
export function cardPosition(
  card: Pick<CreditCard, 'id' | 'limitCents'>,
  invoices: readonly Invoice[],
  txs: readonly Transaction[],
): CardPosition {
  let open = 0;
  let pending = 0;
  for (const inv of invoices) {
    if (inv.cardId !== card.id) continue;
    const t = invoiceTotals(inv, txs);
    open += t.outstandingCents;
    pending += t.pendingCents;
  }
  const used = Math.max(0, open) + pending;
  return {
    limitCents: card.limitCents,
    usedCents: used,
    availableCents: card.limitCents - used,
    pendingCents: pending,
  };
}

/** Fatura que recebe a compra, entre as já existentes (ou o ciclo calculado para criar uma nova). */
export function findOrPlanInvoice(
  card: CreditCard,
  invoices: readonly Invoice[],
  purchaseDate: ISODate,
): { existing: Invoice | null; cycle: InvoiceCycle } {
  const cycle = invoiceCycleFor(card, purchaseDate);
  const existing = invoices.find((i) => i.cardId === card.id && i.closingDate === cycle.closingDate) ?? null;
  return { existing, cycle };
}
