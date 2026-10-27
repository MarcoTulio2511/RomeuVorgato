import { addMonthsClamped, type ISODate } from '../dates';
import { cycleForClosing, closingDateFor, shiftClosing, type InvoiceCycle } from '../invoices/invoices';
import { splitCents, MoneyError, type Cents } from '../money/money';
import type { CreditCard } from '../types';

export const MAX_INSTALLMENTS = 48;

export interface InstallmentSlot {
  number: number;
  amountCents: Cents;
  /** Data de competência da parcela: data da compra + (n−1) meses (limitada ao fim do mês). */
  competenceDate: ISODate;
  invoice: InvoiceCycle;
}

/**
 * Cronograma determinístico de um parcelamento no cartão.
 * - Soma das parcelas == total, sempre (centavos extras vão para as primeiras parcelas).
 * - Parcela n cai no ciclo da 1ª parcela deslocado em n−1 fechamentos.
 */
export function buildInstallmentSchedule(
  card: Pick<CreditCard, 'closingDay' | 'dueDay' | 'closingDayRule'>,
  purchaseDate: ISODate,
  totalCents: Cents,
  count: number,
): InstallmentSlot[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
    throw new MoneyError(`Número de parcelas deve estar entre 1 e ${MAX_INSTALLMENTS}`);
  }
  if (totalCents <= 0) throw new MoneyError('O valor da compra deve ser positivo');
  if (Math.floor(totalCents / count) < 1)
    throw new MoneyError('Valor insuficiente para essa quantidade de parcelas');
  const parts = splitCents(totalCents, count);
  const firstClosing = closingDateFor(card, purchaseDate);
  return parts.map((amountCents, i) => ({
    number: i + 1,
    amountCents,
    competenceDate: addMonthsClamped(purchaseDate, i),
    invoice: cycleForClosing(card, shiftClosing(card, firstClosing, i)),
  }));
}
