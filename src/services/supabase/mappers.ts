import type {
  Account,
  Budget,
  Category,
  CreditCard,
  InstallmentPlan,
  Invoice,
  PlannedTransaction,
  RecurringRule,
  Transaction,
} from '../../domain/types';
import type { Preferences } from '../../domain/snapshot';

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;
const n = (v: unknown) => Number(v);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const d = (v: unknown) => String(v).slice(0, 10);

export const mapAccount = (r: R): Account => ({
  id: r.id,
  householdId: r.household_id,
  ownerId: r.owner_id,
  name: r.name,
  institution: r.institution,
  type: r.type,
  initialBalanceCents: n(r.initial_balance_cents),
  balanceDate: d(r.balance_date),
  isActive: r.is_active,
  includeInConsolidated: r.include_in_consolidated,
});

export const mapCard = (r: R): CreditCard => ({
  id: r.id,
  householdId: r.household_id,
  ownerId: r.owner_id,
  name: r.name,
  institution: r.institution,
  lastFour: r.last_four,
  limitCents: n(r.limit_cents),
  closingDay: n(r.closing_day),
  dueDay: n(r.due_day),
  closingDayRule: r.closing_day_rule,
  payAccountId: r.pay_account_id,
  isActive: r.is_active,
});

export const mapCategory = (r: R): Category => ({
  id: r.id,
  householdId: r.household_id,
  name: r.name,
  kind: r.kind,
  parentId: r.parent_id,
  color: r.color,
  icon: r.icon,
  isActive: r.is_active,
  sortOrder: n(r.sort_order),
});

export const mapTransaction = (r: R): Transaction => ({
  id: r.id,
  householdId: r.household_id,
  type: r.type,
  amountCents: n(r.amount_cents),
  occurredOn: d(r.occurred_on),
  description: r.description,
  categoryId: r.category_id,
  ownerId: r.owner_id,
  accountId: r.account_id,
  cardId: r.card_id,
  scope: r.scope,
  status: r.status,
  notes: r.notes,
  source: r.source,
  sourceId: r.source_id,
  sourceFingerprint: r.source_fingerprint,
  transferGroupId: r.transfer_group_id,
  invoiceId: r.invoice_id,
  installmentPlanId: r.installment_plan_id,
  installmentNumber: nn(r.installment_number),
  reversalOfId: r.reversal_of_id,
  createdAt: r.created_at,
});

export const mapInvoice = (r: R): Invoice => ({
  id: r.id,
  householdId: r.household_id,
  cardId: r.card_id,
  cycleStart: d(r.cycle_start),
  cycleEnd: d(r.cycle_end),
  closingDate: d(r.closing_date),
  dueDate: d(r.due_date),
});

export const mapPlan = (r: R): InstallmentPlan => ({
  id: r.id,
  householdId: r.household_id,
  description: r.description,
  totalCents: n(r.total_cents),
  installmentCount: n(r.installment_count),
  purchaseDate: d(r.purchase_date),
  cardId: r.card_id,
  categoryId: r.category_id,
  ownerId: r.owner_id,
  scope: r.scope,
  status: r.status,
});

export const mapBudget = (r: R): Budget => ({
  id: r.id,
  householdId: r.household_id,
  categoryId: r.category_id,
  ownerId: r.owner_id,
  limitCents: n(r.limit_cents),
  basis: r.basis,
  alertPct: n(r.alert_pct),
  perOrderLimitCents: nn(r.per_order_limit_cents),
  startsOn: d(r.starts_on),
  endsOn: r.ends_on ? d(r.ends_on) : null,
  isActive: r.is_active,
});

export const mapRecurring = (r: R): RecurringRule => ({
  id: r.id,
  householdId: r.household_id,
  description: r.description,
  type: r.type,
  amountCents: n(r.amount_cents),
  frequency: r.frequency,
  intervalCount: n(r.interval_count),
  startDate: d(r.start_date),
  endDate: r.end_date ? d(r.end_date) : null,
  ownerId: r.owner_id,
  accountId: r.account_id,
  cardId: r.card_id,
  categoryId: r.category_id,
  scope: r.scope,
  isCertain: r.is_certain,
  isPrimaryIncome: r.is_primary_income,
  isSubscription: r.is_subscription,
  weekendRule: r.weekend_rule,
  isActive: r.is_active,
});

export const mapPlanned = (r: R): PlannedTransaction => ({
  id: r.id,
  householdId: r.household_id,
  recurringId: r.recurring_id,
  occurrenceKey: r.occurrence_key,
  dueDate: d(r.due_date),
  description: r.description,
  type: r.type,
  amountCents: n(r.amount_cents),
  ownerId: r.owner_id,
  accountId: r.account_id,
  cardId: r.card_id,
  categoryId: r.category_id,
  scope: r.scope,
  status: r.status,
  transactionId: r.transaction_id,
  isCertain: r.is_certain,
  isPrimaryIncome: r.is_primary_income,
  isSubscription: r.is_subscription,
});

export const mapPrefs = (r: R | null): Preferences | null =>
  r
    ? {
        pierreEnabled: r.pierre_enabled,
        pierreMinPeriods: n(r.pierre_min_periods),
        historyVariancePct: n(r.history_variance_pct),
        defaultAlertPct: n(r.default_alert_pct),
        installmentPolicy: r.installment_policy,
      }
    : null;

export interface Member {
  id: string;
  userId: string;
  role: 'admin' | 'member';
  displayName: string;
  isActive: boolean;
}
export const mapMember = (r: R): Member => ({
  id: r.id,
  userId: r.user_id,
  role: r.role,
  displayName: r.display_name,
  isActive: r.is_active,
});

export interface Household {
  id: string;
  name: string;
  currency: string;
  maxMembers: number;
  monthlySavingsGoalCents: number | null;
}
export const mapHousehold = (r: R): Household => ({
  id: r.id,
  name: r.name,
  currency: r.currency,
  maxMembers: n(r.max_members),
  monthlySavingsGoalCents: nn(r.monthly_savings_goal_cents),
});
