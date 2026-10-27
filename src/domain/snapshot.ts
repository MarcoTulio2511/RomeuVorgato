import { addDays, addMonthKey, compareISO, endOfMonth, monthKey, monthRange, type ISODate } from './dates';
import { budgetAppliesTo, budgetUsage, categoryFamily, ordersThatFit } from './budgets/budgets';
import { spendingEvents, type InstallmentPolicy, type SpendingEvent } from './budgets/spending';
import { cardPosition, invoiceStatus, invoiceTotals, type CardPosition } from './invoices/invoices';
import { type Cents } from './money/money';
import { evaluatePierre } from './pierre/engine';
import type { BudgetView, CategoryTrend, InvoiceView, PierreInput, PierreMessage } from './pierre/types';
import {
  cashTimeline,
  defaultHorizon,
  freeCash,
  type Commitment,
  type FreeCashResult,
  type Horizon,
  type TimelinePoint,
} from './projections/freeCash';
import {
  accountBalances,
  consolidatedBalance,
  periodTotals,
  type AccountBalance,
  type PeriodTotals,
  type ViewMode,
} from './transactions/balances';
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
} from './types';

export interface Preferences {
  pierreEnabled: boolean;
  pierreMinPeriods: number;
  historyVariancePct: number;
  defaultAlertPct: number;
  installmentPolicy: InstallmentPolicy;
}

export const DEFAULT_PREFERENCES: Preferences = {
  pierreEnabled: true,
  pierreMinPeriods: 3,
  historyVariancePct: 30,
  defaultAlertPct: 80,
  installmentPolicy: 'parcel',
};

export interface HouseholdData {
  currentUserId: string;
  accounts: Account[];
  cards: CreditCard[];
  categories: Category[];
  transactions: Transaction[];
  invoices: Invoice[];
  plans: InstallmentPlan[];
  budgets: Budget[];
  recurring: RecurringRule[];
  planned: PlannedTransaction[];
  prefs: Preferences;
  savingsGoalCents: Cents | null;
}

export interface Snapshot {
  today: ISODate;
  view: ViewMode;
  accountBalances: AccountBalance[];
  consolidatedCents: Cents;
  cards: Array<{ card: CreditCard; position: CardPosition }>;
  invoiceViews: InvoiceView[];
  month: { key: string; totals: PeriodTotals; shared: PeriodTotals; individual: PeriodTotals };
  budgetViews: BudgetView[];
  freeCash: FreeCashResult;
  horizon: Horizon;
  timeline: TimelinePoint[];
  nextCommitment: Commitment | null;
  pierreInput: PierreInput;
  messages: PierreMessage[];
  eventsCompetence: SpendingEvent[];
  eventsInvoice: SpendingEvent[];
}

/** Aplica a visão (conjunta ou de uma pessoa) a todas as coleções, de forma consistente. */
export function scopeData(data: HouseholdData, view: ViewMode): HouseholdData {
  if (view.kind === 'joint') return data;
  const u = view.userId;
  const cards = data.cards.filter((c) => c.ownerId === u);
  const cardIds = new Set(cards.map((c) => c.id));
  return {
    ...data,
    accounts: data.accounts.filter((a) => a.ownerId === u),
    cards,
    transactions: data.transactions.filter((t) => t.ownerId === u),
    invoices: data.invoices.filter((i) => cardIds.has(i.cardId)),
    plans: data.plans.filter((p) => p.ownerId === u),
    budgets: data.budgets.filter((b) => b.ownerId === null || b.ownerId === u),
    recurring: data.recurring.filter((r) => r.ownerId === u),
    planned: data.planned.filter((p) => p.ownerId === u),
  };
}

function sumEvents(events: readonly SpendingEvent[], ids: Set<string>, from: ISODate, to: ISODate): Cents {
  let s = 0;
  for (const e of events) {
    if (e.categoryId && ids.has(e.categoryId) && compareISO(e.date, from) >= 0 && compareISO(e.date, to) <= 0)
      s += e.amountCents;
  }
  return s;
}

export function buildSnapshot(full: HouseholdData, today: ISODate, view: ViewMode): Snapshot {
  const data = scopeData(full, view);
  const key = monthKey(today);
  const first = `${key}-01`;
  const last = endOfMonth(today);

  const ctxBase = {
    invoices: data.invoices,
    plans: data.plans,
    installmentPolicy: data.prefs.installmentPolicy,
  };
  const eventsCompetence = spendingEvents(data.transactions, { ...ctxBase, basis: 'competence' });
  const eventsInvoice = spendingEvents(data.transactions, { ...ctxBase, basis: 'invoice' });

  const balances = accountBalances(data.accounts, data.transactions, today);
  const consolidated = consolidatedBalance(data.accounts, data.transactions, today);

  const cardById = new Map(data.cards.map((c) => [c.id, c]));
  const invoiceViews: InvoiceView[] = data.invoices
    .map((invoice) => {
      const totals = invoiceTotals(invoice, data.transactions);
      return {
        invoice,
        cardName: cardById.get(invoice.cardId)?.name ?? 'Cartão',
        totals,
        status: invoiceStatus(invoice, totals, today),
      };
    })
    .filter((v) => v.totals.outstandingCents !== 0 || v.status === 'open')
    .sort((a, b) => compareISO(a.invoice.dueDate, b.invoice.dueDate));

  const cards = data.cards.map((card) => ({
    card,
    position: cardPosition(card, data.invoices, data.transactions),
  }));

  const month = {
    key,
    totals: periodTotals(data.transactions, first, last),
    shared: periodTotals(data.transactions, first, last, 'shared'),
    individual: periodTotals(data.transactions, first, last, 'individual'),
  };

  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const budgetViews: BudgetView[] = data.budgets
    .filter((b) => budgetAppliesTo(b, key))
    .map((budget) => {
      const events = budget.basis === 'invoice' ? eventsInvoice : eventsCompetence;
      const usage = budgetUsage(budget, events, data.categories, key, today);
      return {
        budget,
        categoryName: catName.get(budget.categoryId) ?? 'Categoria',
        usage,
        orders: budget.perOrderLimitCents
          ? ordersThatFit(usage.remainingCents, budget.perOrderLimitCents)
          : null,
      };
    });

  const horizon = defaultHorizon(data.planned, today);
  const fcInput = {
    today,
    horizon: horizon.date,
    accounts: data.accounts,
    cards: data.cards,
    invoices: data.invoices,
    txs: data.transactions,
    planned: data.planned,
  };
  const fc = freeCash(fcInput);
  const timeline = cashTimeline(fcInput);

  // --- insumos do Pierre ---
  const incomes = data.planned
    .filter((p) => p.type === 'income' && p.status === 'planned' && compareISO(p.dueDate, today) >= 0)
    .sort((a, b) => compareISO(a.dueDate, b.dueDate));
  const nextIncome = incomes.find((p) => p.isPrimaryIncome) ?? incomes[0] ?? null;
  const upcomingSubscriptions = data.planned.filter(
    (p) =>
      p.isSubscription &&
      p.status === 'planned' &&
      compareISO(p.dueDate, today) >= 0 &&
      compareISO(p.dueDate, addDays(today, 3)) <= 0,
  );

  const monthKeys = data.transactions
    .filter((t) => t.status === 'posted')
    .map((t) => monthKey(t.occurredOn))
    .sort();
  const earliest = monthKeys[0];
  const prevKey = addMonthKey(key, -1);
  const historyPeriods =
    earliest && earliest <= prevKey ? Math.min(12, monthRange(earliest, prevKey).length) : 0;
  const trendPeriods = Math.min(6, historyPeriods);
  const trends: CategoryTrend[] = [];
  if (trendPeriods > 0) {
    const from = `${addMonthKey(key, -trendPeriods)}-01`;
    const to = endOfMonth(`${prevKey}-01`);
    for (const c of data.categories.filter((x) => x.kind === 'expense' && x.parentId === null)) {
      const ids = categoryFamily(data.categories, c.id);
      const past = sumEvents(eventsCompetence, ids, from, to);
      trends.push({
        categoryId: c.id,
        name: c.name,
        currentSpentCents: sumEvents(eventsCompetence, ids, first, last),
        averagePastCents: Math.floor(past / trendPeriods),
        periods: trendPeriods,
      });
    }
  }

  const pierreInput: PierreInput = {
    today,
    prefs: {
      enabled: data.prefs.pierreEnabled,
      minPeriods: data.prefs.pierreMinPeriods,
      variancePct: data.prefs.historyVariancePct,
    },
    budgets: budgetViews,
    invoices: invoiceViews,
    freeCash: data.accounts.length > 0 ? fc : null,
    horizon: data.accounts.length > 0 ? horizon : null,
    nextIncome,
    upcomingSubscriptions,
    trends,
    historyPeriods,
    savings: full.savingsGoalCents
      ? { goalCents: full.savingsGoalCents, savedCents: month.totals.netCents }
      : null,
    hasAnyData: data.accounts.length > 0 || data.cards.length > 0,
  };

  return {
    today,
    view,
    accountBalances: balances,
    consolidatedCents: consolidated,
    cards,
    invoiceViews,
    month,
    budgetViews,
    freeCash: fc,
    horizon,
    timeline,
    nextCommitment: fc.commitments[0] ?? null,
    pierreInput,
    messages: evaluatePierre(pierreInput),
    eventsCompetence,
    eventsInvoice,
  };
}
