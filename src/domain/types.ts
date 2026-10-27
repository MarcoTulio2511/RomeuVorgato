import type { ISODate } from './dates';
import type { Cents } from './money/money';

export type TxType =
  | 'income'
  | 'expense'
  | 'refund' // estorno/crédito creditado em conta (reduz gasto da categoria; não é receita)
  | 'transfer_out'
  | 'transfer_in'
  | 'card_purchase'
  | 'card_refund' // estorno/crédito no cartão (reduz fatura e gasto)
  | 'card_fee' // encargos, juros, anuidade (aumenta fatura)
  | 'invoice_payment'
  | 'adjustment_in' // ajuste de saldo controlado (exige justificativa)
  | 'adjustment_out';

export type TxStatus = 'posted' | 'pending' | 'cancelled';
export type Scope = 'individual' | 'shared';
export type TxSource = 'manual' | 'import' | 'recurring' | 'system';
export type AccountType = 'checking' | 'savings' | 'cash' | 'digital_wallet';
export type ClosingDayRule = 'next' | 'current';

export interface Account {
  id: string;
  householdId: string;
  ownerId: string;
  name: string;
  institution: string | null;
  type: AccountType;
  initialBalanceCents: Cents;
  /** Saldo inicial vale no INÍCIO desta data; movimentações anteriores são ignoradas. */
  balanceDate: ISODate;
  isActive: boolean;
  includeInConsolidated: boolean;
}

export interface CreditCard {
  id: string;
  householdId: string;
  ownerId: string;
  name: string;
  institution: string | null;
  lastFour: string | null;
  limitCents: Cents;
  closingDay: number;
  dueDay: number;
  /**
   * Compra feita NO dia do fechamento:
   * 'next' (padrão) = entra na fatura seguinte; 'current' = ainda entra na fatura que fecha naquele dia.
   */
  closingDayRule: ClosingDayRule;
  payAccountId: string | null;
  isActive: boolean;
}

export interface Category {
  id: string;
  householdId: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  parentId: string | null;
  color: string;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface Transaction {
  id: string;
  householdId: string;
  type: TxType;
  /** Sempre positivo; o sentido vem de `type`. */
  amountCents: Cents;
  occurredOn: ISODate;
  description: string;
  categoryId: string | null;
  ownerId: string;
  accountId: string | null;
  cardId: string | null;
  scope: Scope;
  status: TxStatus;
  notes: string | null;
  source: TxSource;
  sourceId: string | null;
  sourceFingerprint: string | null;
  transferGroupId: string | null;
  invoiceId: string | null;
  installmentPlanId: string | null;
  installmentNumber: number | null;
  reversalOfId: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  householdId: string;
  cardId: string;
  cycleStart: ISODate;
  cycleEnd: ISODate;
  closingDate: ISODate;
  dueDate: ISODate;
}

export interface InstallmentPlan {
  id: string;
  householdId: string;
  description: string;
  totalCents: Cents;
  installmentCount: number;
  purchaseDate: ISODate;
  cardId: string;
  categoryId: string | null;
  ownerId: string;
  scope: Scope;
  status: 'active' | 'cancelled';
}

export type BudgetBasis = 'competence' | 'invoice';

export interface Budget {
  id: string;
  householdId: string;
  categoryId: string;
  /** null = orçamento compartilhado (considera gastos de todos). */
  ownerId: string | null;
  limitCents: Cents;
  basis: BudgetBasis;
  alertPct: number;
  perOrderLimitCents: Cents | null;
  startsOn: ISODate;
  endsOn: ISODate | null;
  isActive: boolean;
}

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export type WeekendRule = 'none' | 'previous_business_day' | 'next_business_day';

export interface RecurringRule {
  id: string;
  householdId: string;
  description: string;
  type: 'income' | 'expense';
  amountCents: Cents;
  frequency: Frequency;
  intervalCount: number;
  startDate: ISODate;
  endDate: ISODate | null;
  ownerId: string;
  accountId: string | null;
  cardId: string | null;
  categoryId: string | null;
  scope: Scope;
  /** Receita confirmada (ex.: salário CLT) vs. estimada (freela). Só confirmada entra no "garantido". */
  isCertain: boolean;
  isPrimaryIncome: boolean;
  isSubscription: boolean;
  weekendRule: WeekendRule;
  isActive: boolean;
}

export interface PlannedTransaction {
  id: string;
  householdId: string;
  recurringId: string | null;
  occurrenceKey: string;
  dueDate: ISODate;
  description: string;
  type: 'income' | 'expense';
  amountCents: Cents;
  ownerId: string;
  accountId: string | null;
  cardId: string | null;
  categoryId: string | null;
  scope: Scope;
  status: 'planned' | 'realized' | 'skipped';
  transactionId: string | null;
  isCertain: boolean;
  isPrimaryIncome: boolean;
  isSubscription: boolean;
}
