import { compareISO, type ISODate } from '../dates';
import type { Cents } from '../money/money';
import type { BudgetBasis, InstallmentPlan, Invoice, Scope, Transaction } from '../types';

/**
 * Política de reconhecimento de parcelamentos (escolha explícita, exibida na interface):
 * - 'parcel'   → cada parcela é reconhecida na sua data de competência (padrão);
 * - 'purchase' → o total da compra é reconhecido uma única vez, na data da compra (parcelas ignoradas).
 * Nunca se somam compra integral e parcelas.
 */
export type InstallmentPolicy = 'parcel' | 'purchase';

export interface SpendingEvent {
  txId: string;
  /** Data em que o gasto é reconhecido (competência ou vencimento da fatura, conforme a base). */
  date: ISODate;
  /** Positivo = gasto; negativo = estorno/crédito (reduz o gasto líquido). */
  amountCents: Cents;
  categoryId: string | null;
  ownerId: string;
  scope: Scope;
  description: string;
}

export interface SpendingContext {
  invoices: readonly Invoice[];
  plans: readonly InstallmentPlan[];
  basis: BudgetBasis;
  installmentPolicy: InstallmentPolicy;
}

const SPEND_SIGN: Partial<Record<Transaction['type'], 1 | -1>> = {
  expense: 1,
  card_purchase: 1,
  card_fee: 1,
  refund: -1,
  card_refund: -1,
};

/**
 * Transforma lançamentos em eventos de consumo. Ficam de fora: receitas, transferências internas,
 * pagamentos de fatura (a despesa já foi contada na compra) e ajustes de saldo.
 */
export function spendingEvents(txs: readonly Transaction[], ctx: SpendingContext): SpendingEvent[] {
  const invoiceById = new Map(ctx.invoices.map((i) => [i.id, i]));
  const planById = new Map(ctx.plans.map((p) => [p.id, p]));
  const out: SpendingEvent[] = [];

  for (const t of txs) {
    if (t.status !== 'posted') continue;
    const sign = SPEND_SIGN[t.type];
    if (!sign) continue;

    let date = t.occurredOn;
    let amount = t.amountCents;

    const plan = t.installmentPlanId ? planById.get(t.installmentPlanId) : undefined;
    if (
      plan &&
      t.type === 'card_purchase' &&
      ctx.installmentPolicy === 'purchase' &&
      ctx.basis === 'competence'
    ) {
      if (t.installmentNumber !== 1) continue; // total reconhecido uma única vez
      date = plan.purchaseDate;
      amount = plan.totalCents;
    } else if (ctx.basis === 'invoice' && t.invoiceId) {
      const inv = invoiceById.get(t.invoiceId);
      if (inv) date = inv.dueDate;
    }

    out.push({
      txId: t.id,
      date,
      amountCents: sign * amount,
      categoryId: t.categoryId,
      ownerId: t.ownerId,
      scope: t.scope,
      description: t.description,
    });
  }
  return out;
}

export function inRange(date: ISODate, from: ISODate, to: ISODate): boolean {
  return compareISO(date, from) >= 0 && compareISO(date, to) <= 0;
}
