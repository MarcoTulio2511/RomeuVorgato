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
} from '../../src/domain/types';

export const H = 'house-1';
export const ANA = 'user-ana';
export const BRU = 'user-bru';

let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

export function account(over: Partial<Account> = {}): Account {
  return {
    id: id('acc'),
    householdId: H,
    ownerId: ANA,
    name: 'Conta',
    institution: null,
    type: 'checking',
    initialBalanceCents: 0,
    balanceDate: '2026-01-01',
    isActive: true,
    includeInConsolidated: true,
    ...over,
  };
}

export function card(over: Partial<CreditCard> = {}): CreditCard {
  return {
    id: id('card'),
    householdId: H,
    ownerId: ANA,
    name: 'Cartão',
    institution: null,
    lastFour: null,
    limitCents: 500_000,
    closingDay: 25,
    dueDay: 5,
    closingDayRule: 'next',
    payAccountId: null,
    isActive: true,
    ...over,
  };
}

export function category(over: Partial<Category> = {}): Category {
  return {
    id: id('cat'),
    householdId: H,
    name: 'Categoria',
    kind: 'expense',
    parentId: null,
    color: '#fff',
    icon: null,
    isActive: true,
    sortOrder: 0,
    ...over,
  };
}

export function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: id('tx'),
    householdId: H,
    type: 'expense',
    amountCents: 1000,
    occurredOn: '2026-03-10',
    description: 'Lançamento',
    categoryId: null,
    ownerId: ANA,
    accountId: null,
    cardId: null,
    scope: 'individual',
    status: 'posted',
    notes: null,
    source: 'manual',
    sourceId: null,
    sourceFingerprint: null,
    transferGroupId: null,
    invoiceId: null,
    installmentPlanId: null,
    installmentNumber: null,
    reversalOfId: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

export function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: id('inv'),
    householdId: H,
    cardId: 'card-x',
    cycleStart: '2026-02-25',
    cycleEnd: '2026-03-24',
    closingDate: '2026-03-25',
    dueDate: '2026-04-05',
    ...over,
  };
}

export function plan(over: Partial<InstallmentPlan> = {}): InstallmentPlan {
  return {
    id: id('plan'),
    householdId: H,
    description: 'Compra parcelada',
    totalCents: 100_00,
    installmentCount: 3,
    purchaseDate: '2026-03-10',
    cardId: 'card-x',
    categoryId: null,
    ownerId: ANA,
    scope: 'individual',
    status: 'active',
    ...over,
  };
}

export function budget(over: Partial<Budget> = {}): Budget {
  return {
    id: id('bud'),
    householdId: H,
    categoryId: 'cat-x',
    ownerId: null,
    limitCents: 40_000,
    basis: 'competence',
    alertPct: 80,
    perOrderLimitCents: null,
    startsOn: '2026-01-01',
    endsOn: null,
    isActive: true,
    ...over,
  };
}

export function recurring(over: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: id('rec'),
    householdId: H,
    description: 'Regra',
    type: 'expense',
    amountCents: 10_000,
    frequency: 'monthly',
    intervalCount: 1,
    startDate: '2026-01-05',
    endDate: null,
    ownerId: ANA,
    accountId: null,
    cardId: null,
    categoryId: null,
    scope: 'shared',
    isCertain: true,
    isPrimaryIncome: false,
    isSubscription: false,
    weekendRule: 'none',
    isActive: true,
    ...over,
  };
}

export function planned(over: Partial<PlannedTransaction> = {}): PlannedTransaction {
  return {
    id: id('pl'),
    householdId: H,
    recurringId: null,
    occurrenceKey: id('key'),
    dueDate: '2026-03-20',
    description: 'Previsto',
    type: 'expense',
    amountCents: 10_000,
    ownerId: ANA,
    accountId: null,
    cardId: null,
    categoryId: null,
    scope: 'shared',
    status: 'planned',
    transactionId: null,
    isCertain: true,
    isPrimaryIncome: false,
    isSubscription: false,
    ...over,
  };
}
