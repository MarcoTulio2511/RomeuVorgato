import type { ISODate } from '../../domain/dates';
import type { Cents } from '../../domain/money/money';
import type { NormalizedRow } from '../../domain/imports/normalize';
import { DEFAULT_PREFERENCES, type HouseholdData, type Preferences } from '../../domain/snapshot';
import type {
  Scope,
  Transaction,
  TxType,
  WeekendRule,
  Frequency,
  AccountType,
  ClosingDayRule,
  BudgetBasis,
} from '../../domain/types';
import { getClient } from './client';
import { toAppError } from './errors';
import {
  mapAccount,
  mapBudget,
  mapCard,
  mapCategory,
  mapHousehold,
  mapInvoice,
  mapMember,
  mapPlan,
  mapPlanned,
  mapPrefs,
  mapRecurring,
  mapTransaction,
  type Household,
  type Member,
} from './mappers';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

/** Resolve {data,error} do supabase-js; erros viram AppError amigável. */
async function unwrap<T>(q: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw toAppError(error);
  return data as T;
}

async function rpc<T = Json>(fn: string, args: Json): Promise<T> {
  return unwrap<T>(getClient().rpc(fn, args) as PromiseLike<{ data: T | null; error: unknown }>);
}

/** Pagina de 1000 em 1000 (limite do PostgREST) até acabar. */
async function fetchAll(
  build: (from: number, to: number) => PromiseLike<{ data: Json[] | null; error: unknown }>,
): Promise<Json[]> {
  const out: Json[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await unwrap(build(from, from + 999));
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/* ============================== Casa e sessão ============================== */
export interface Membership {
  household: Household;
  member: Member;
}

export async function getMyMembership(userId: string): Promise<Membership | null> {
  const c = getClient();
  const members = await unwrap<Json[]>(
    c.from('household_members').select('*').eq('user_id', userId).eq('is_active', true).limit(1),
  );
  const m = members[0];
  if (!m) return null;
  const h = await unwrap<Json>(c.from('households').select('*').eq('id', m.household_id).single());
  return { household: mapHousehold(h), member: mapMember(m) };
}

export const createHousehold = (name: string, displayName: string) =>
  rpc<string>('create_household', { p_name: name, p_display_name: displayName });
export const acceptInvitation = (token: string, displayName: string) =>
  rpc<string>('accept_invitation', { p_token: token.trim(), p_display_name: displayName });
export const createInvitation = (householdId: string, email: string | null, validHours = 168) =>
  rpc<{ id: string; token: string; expires_at: string }>('create_invitation', {
    p_household_id: householdId,
    p_email: email,
    p_valid_hours: validHours,
  });
export const revokeInvitation = (id: string) => rpc('revoke_invitation', { p_invitation_id: id });
export const removeMember = (memberId: string) => rpc('remove_member', { p_member_id: memberId });

export interface InvitationRow {
  id: string;
  email: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
export async function listInvitations(householdId: string): Promise<InvitationRow[]> {
  const rows = await unwrap<Json[]>(
    getClient()
      .from('household_invitations')
      .select('id,email,expires_at,used_at,revoked_at,created_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(20),
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  }));
}

export const updateHousehold = (
  id: string,
  patch: { name?: string; monthly_savings_goal_cents?: number | null },
) => unwrap(getClient().from('households').update(patch).eq('id', id));
export const updateMyDisplayName = (memberId: string, displayName: string) =>
  unwrap(getClient().from('household_members').update({ display_name: displayName }).eq('id', memberId));

/* ============================== Carga completa ============================== */
export interface Bundle {
  data: HouseholdData;
  members: Member[];
  household: Household;
}

export async function loadBundle(household: Household, userId: string, today: ISODate): Promise<Bundle> {
  const c = getClient();
  const h = household.id;
  // Materializa previstos das regras (idempotente, só gera linhas de planejamento — nunca lançamentos).
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 120);
  await rpc('materialize_recurring', {
    p_household_id: h,
    p_until: horizon.toISOString().slice(0, 10),
    p_rebuild_rule: null,
  }).catch(() => undefined);

  const [accounts, cards, categories, txs, invoices, plans, budgets, recurring, planned, members, prefs, hh] =
    await Promise.all([
      unwrap<Json[]>(c.from('accounts').select('*').eq('household_id', h).order('created_at')),
      unwrap<Json[]>(c.from('credit_cards').select('*').eq('household_id', h).order('created_at')),
      unwrap<Json[]>(
        c.from('categories').select('*').eq('household_id', h).order('sort_order').order('name'),
      ),
      fetchAll((a, b) =>
        c
          .from('transactions')
          .select('*')
          .eq('household_id', h)
          .neq('status', 'cancelled')
          .order('occurred_on', { ascending: false })
          .order('id')
          .range(a, b),
      ),
      fetchAll((a, b) =>
        c.from('card_invoices').select('*').eq('household_id', h).order('due_date').order('id').range(a, b),
      ),
      unwrap<Json[]>(c.from('installment_plans').select('*').eq('household_id', h).eq('status', 'active')),
      unwrap<Json[]>(c.from('budgets').select('*').eq('household_id', h)),
      unwrap<Json[]>(c.from('recurring_transactions').select('*').eq('household_id', h).order('created_at')),
      unwrap<Json[]>(
        c
          .from('planned_transactions')
          .select('*')
          .eq('household_id', h)
          .neq('status', 'skipped')
          .order('due_date')
          .limit(2000),
      ),
      unwrap<Json[]>(c.from('household_members').select('*').eq('household_id', h)),
      unwrap<Json[]>(c.from('user_preferences').select('*').eq('user_id', userId).limit(1)),
      unwrap<Json>(c.from('households').select('*').eq('id', h).single()),
    ]);
  const hhm = mapHousehold(hh);
  return {
    household: hhm,
    members: members.map(mapMember),
    data: {
      currentUserId: userId,
      accounts: accounts.map(mapAccount),
      cards: cards.map(mapCard),
      categories: categories.map(mapCategory),
      transactions: txs.map(mapTransaction),
      invoices: invoices.map(mapInvoice),
      plans: plans.map(mapPlan),
      budgets: budgets.map(mapBudget),
      recurring: recurring.map(mapRecurring),
      planned: planned.map(mapPlanned),
      prefs: mapPrefs(prefs[0] ?? null) ?? DEFAULT_PREFERENCES,
      savingsGoalCents: hhm.monthlySavingsGoalCents,
    },
  };
}

/* ============================== Movimentações (lista paginada) ============================== */
export type TypeGroup = 'income' | 'expense' | 'transfer' | 'payment' | 'refund' | 'adjustment';
export const TYPE_GROUPS: Record<TypeGroup, TxType[]> = {
  income: ['income'],
  expense: ['expense', 'card_purchase', 'card_fee'],
  transfer: ['transfer_in', 'transfer_out'],
  payment: ['invoice_payment'],
  refund: ['refund', 'card_refund'],
  adjustment: ['adjustment_in', 'adjustment_out'],
};

export interface TxFilters {
  from?: ISODate;
  to?: ISODate;
  ownerId?: string;
  accountId?: string;
  cardId?: string;
  categoryId?: string;
  group?: TypeGroup;
  search?: string;
  page: number;
  pageSize: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listTransactions(
  householdId: string,
  f: TxFilters,
): Promise<{ rows: Transaction[]; count: number }> {
  let q = getClient()
    .from('transactions')
    .select('*', { count: 'exact' })
    .eq('household_id', householdId)
    .neq('status', 'cancelled');
  if (f.from) q = q.gte('occurred_on', f.from);
  if (f.to) q = q.lte('occurred_on', f.to);
  if (f.ownerId) q = q.eq('owner_id', f.ownerId);
  if (f.accountId) q = q.eq('account_id', f.accountId);
  if (f.cardId) q = q.eq('card_id', f.cardId);
  if (f.categoryId) q = q.eq('category_id', f.categoryId);
  if (f.group) q = q.in('type', TYPE_GROUPS[f.group]);
  if (f.search?.trim()) q = q.ilike('description', `%${escapeLike(f.search.trim())}%`);
  const from = f.page * f.pageSize;
  const { data, error, count } = await q
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + f.pageSize - 1);
  if (error) throw toAppError(error);
  return { rows: (data ?? []).map(mapTransaction), count: count ?? 0 };
}

/* ============================== Operações financeiras (RPC) ============================== */
export interface NewTransaction {
  householdId: string;
  requestId: string;
  type: Extract<
    TxType,
    | 'income'
    | 'expense'
    | 'refund'
    | 'adjustment_in'
    | 'adjustment_out'
    | 'card_purchase'
    | 'card_refund'
    | 'card_fee'
  >;
  amountCents: Cents;
  occurredOn: ISODate;
  description: string;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  scope: Scope;
  notes: string | null;
  status?: 'posted' | 'pending';
}
export const createTransaction = (t: NewTransaction) =>
  rpc<{ id: string }>('create_transaction', {
    p_household_id: t.householdId,
    p_request_id: t.requestId,
    p_type: t.type,
    p_amount_cents: t.amountCents,
    p_occurred_on: t.occurredOn,
    p_description: t.description,
    p_category_id: t.categoryId,
    p_account_id: t.accountId,
    p_card_id: t.cardId,
    p_scope: t.scope,
    p_notes: t.notes,
    p_status: t.status ?? 'posted',
  });

export const createTransfer = (p: {
  householdId: string;
  requestId: string;
  from: string;
  to: string;
  amountCents: Cents;
  occurredOn: ISODate;
  description: string;
}) =>
  rpc('create_transfer', {
    p_household_id: p.householdId,
    p_request_id: p.requestId,
    p_from_account: p.from,
    p_to_account: p.to,
    p_amount_cents: p.amountCents,
    p_occurred_on: p.occurredOn,
    p_description: p.description,
  });

export const createInstallmentPurchase = (p: {
  householdId: string;
  requestId: string;
  cardId: string;
  description: string;
  totalCents: Cents;
  installments: number;
  purchaseDate: ISODate;
  categoryId: string | null;
  scope: Scope;
  notes: string | null;
}) =>
  rpc<{ plan_id: string }>('create_installment_purchase', {
    p_household_id: p.householdId,
    p_request_id: p.requestId,
    p_card_id: p.cardId,
    p_description: p.description,
    p_total_cents: p.totalCents,
    p_installments: p.installments,
    p_purchase_date: p.purchaseDate,
    p_category_id: p.categoryId,
    p_scope: p.scope,
    p_notes: p.notes,
  });

export const cancelInstallmentPlan = (planId: string, requestId: string) =>
  rpc('cancel_installment_plan', { p_plan_id: planId, p_request_id: requestId });

export const payInvoice = (p: {
  invoiceId: string;
  requestId: string;
  accountId: string;
  amountCents: Cents;
  occurredOn: ISODate;
}) =>
  rpc<{ id: string; remaining_cents: number }>('pay_invoice', {
    p_invoice_id: p.invoiceId,
    p_request_id: p.requestId,
    p_account_id: p.accountId,
    p_amount_cents: p.amountCents,
    p_occurred_on: p.occurredOn,
  });

export const updateTransaction = (p: {
  id: string;
  description?: string;
  categoryId?: string | null;
  clearCategory?: boolean;
  notes?: string;
  scope?: Scope;
  occurredOn?: ISODate;
  amountCents?: Cents;
  accountId?: string;
}) =>
  rpc('update_transaction', {
    p_tx_id: p.id,
    p_description: p.description ?? null,
    p_category_id: p.categoryId ?? null,
    p_clear_category: p.clearCategory ?? false,
    p_notes: p.notes ?? null,
    p_scope: p.scope ?? null,
    p_occurred_on: p.occurredOn ?? null,
    p_amount_cents: p.amountCents ?? null,
    p_account_id: p.accountId ?? null,
  });

export const cancelTransaction = (id: string, requestId: string) =>
  rpc('cancel_transaction', { p_tx_id: id, p_request_id: requestId });
export const reverseTransaction = (id: string, requestId: string, date: ISODate) =>
  rpc('reverse_transaction', { p_tx_id: id, p_request_id: requestId, p_occurred_on: date });
export const settlePlanned = (p: {
  id: string;
  requestId: string;
  accountId?: string | null;
  cardId?: string | null;
  amountCents?: Cents | null;
  occurredOn?: ISODate | null;
}) =>
  rpc('settle_planned', {
    p_planned_id: p.id,
    p_request_id: p.requestId,
    p_account_id: p.accountId ?? null,
    p_card_id: p.cardId ?? null,
    p_amount_cents: p.amountCents ?? null,
    p_occurred_on: p.occurredOn ?? null,
  });
export const skipPlanned = (id: string) => rpc('skip_planned', { p_planned_id: id });
export const reassignCategory = (from: string, to: string) =>
  rpc('reassign_category', { p_from: from, p_to: to });
export const rebuildRecurring = (householdId: string, ruleId: string, until: ISODate) =>
  rpc('materialize_recurring', { p_household_id: householdId, p_until: until, p_rebuild_rule: ruleId });

/* ============================== Cadastros (RLS direta) ============================== */
const table = (name: string) => getClient().from(name);
export interface AccountInput {
  name: string;
  institution: string | null;
  type: AccountType;
  initial_balance_cents: Cents;
  balance_date: ISODate;
  include_in_consolidated: boolean;
  is_active?: boolean;
}
export const insertAccount = (householdId: string, ownerId: string, a: AccountInput) =>
  unwrap(table('accounts').insert({ household_id: householdId, owner_id: ownerId, ...a }));
export const updateAccount = (id: string, a: Partial<AccountInput>) =>
  unwrap(table('accounts').update(a).eq('id', id));
export const deleteAccount = (id: string) => unwrap(table('accounts').delete().eq('id', id));

export interface CardInput {
  name: string;
  institution: string | null;
  last_four: string | null;
  limit_cents: Cents;
  closing_day: number;
  due_day: number;
  closing_day_rule: ClosingDayRule;
  pay_account_id: string | null;
  is_active?: boolean;
}
export const insertCard = (householdId: string, ownerId: string, c: CardInput) =>
  unwrap(table('credit_cards').insert({ household_id: householdId, owner_id: ownerId, ...c }));
export const updateCard = (id: string, c: Partial<CardInput>) =>
  unwrap(table('credit_cards').update(c).eq('id', id));
export const deleteCard = (id: string) => unwrap(table('credit_cards').delete().eq('id', id));

export interface CategoryInput {
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  parent_id: string | null;
  color: string;
  sort_order?: number;
  is_active?: boolean;
}
export const insertCategory = (householdId: string, c: CategoryInput) =>
  unwrap(table('categories').insert({ household_id: householdId, ...c }));
export const updateCategory = (id: string, c: Partial<CategoryInput>) =>
  unwrap(table('categories').update(c).eq('id', id));
export const deleteCategory = (id: string) => unwrap(table('categories').delete().eq('id', id));

export interface BudgetInput {
  category_id: string;
  owner_id: string | null;
  limit_cents: Cents;
  basis: BudgetBasis;
  alert_pct: number;
  per_order_limit_cents: Cents | null;
  starts_on: ISODate;
  ends_on?: ISODate | null;
}
export const insertBudget = (householdId: string, b: BudgetInput) =>
  unwrap(table('budgets').insert({ household_id: householdId, ...b }));
export const updateBudget = (
  id: string,
  b: Partial<Omit<BudgetInput, 'category_id' | 'owner_id'>> & { is_active?: boolean },
) => unwrap(table('budgets').update(b).eq('id', id));
export const deleteBudget = (id: string) => unwrap(table('budgets').delete().eq('id', id));

export interface RecurringInput {
  description: string;
  type: 'income' | 'expense';
  amount_cents: Cents;
  frequency: Frequency;
  interval_count: number;
  start_date: ISODate;
  end_date: ISODate | null;
  account_id: string | null;
  card_id: string | null;
  category_id: string | null;
  scope: Scope;
  is_certain: boolean;
  is_primary_income: boolean;
  is_subscription: boolean;
  weekend_rule: WeekendRule;
  is_active?: boolean;
}
export async function insertRecurring(
  householdId: string,
  ownerId: string,
  r: RecurringInput,
): Promise<string> {
  const rows = await unwrap<Json[]>(
    table('recurring_transactions')
      .insert({ household_id: householdId, owner_id: ownerId, ...r })
      .select('id'),
  );
  return rows[0]!.id as string;
}
export const updateRecurring = (id: string, r: Partial<RecurringInput>) =>
  unwrap(table('recurring_transactions').update(r).eq('id', id));
export const deleteRecurring = (id: string) => unwrap(table('recurring_transactions').delete().eq('id', id));

export interface PlannedInput {
  due_date: ISODate;
  description: string;
  type: 'income' | 'expense';
  amount_cents: Cents;
  account_id: string | null;
  card_id: string | null;
  category_id: string | null;
  scope: Scope;
  is_certain: boolean;
}
export const insertPlanned = (householdId: string, ownerId: string, p: PlannedInput) =>
  unwrap(
    table('planned_transactions').insert({
      household_id: householdId,
      owner_id: ownerId,
      occurrence_key: `manual:${crypto.randomUUID()}`,
      ...p,
    }),
  );
export const deletePlanned = (id: string) => unwrap(table('planned_transactions').delete().eq('id', id));

export async function savePreferences(userId: string, householdId: string, p: Preferences): Promise<void> {
  await unwrap(
    table('user_preferences').upsert({
      user_id: userId,
      household_id: householdId,
      pierre_enabled: p.pierreEnabled,
      pierre_min_periods: p.pierreMinPeriods,
      history_variance_pct: p.historyVariancePct,
      default_alert_pct: p.defaultAlertPct,
      installment_policy: p.installmentPolicy,
    }),
  );
}

/* ============================== Pierre (mensagens persistentes) ============================== */
export interface StoredMessage {
  dedupeKey: string;
  lastSeenAt: string;
  dismissedAt: string | null;
  snoozedUntil: string | null;
}
export async function loadPierreHistory(userId: string): Promise<StoredMessage[]> {
  const rows = await unwrap<Json[]>(
    table('pierre_messages')
      .select('dedupe_key,last_seen_at,dismissed_at,snoozed_until')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(300),
  );
  return rows.map((r) => ({
    dedupeKey: r.dedupe_key,
    lastSeenAt: r.last_seen_at,
    dismissedAt: r.dismissed_at,
    snoozedUntil: r.snoozed_until,
  }));
}
export async function recordPierreMessage(
  userId: string,
  householdId: string,
  m: { ruleId: string; dedupeKey: string; severity: string; title: string; body: string; data: Json },
  patch: { dismiss?: boolean; snoozeUntil?: string } = {},
): Promise<void> {
  const now = new Date().toISOString();
  await unwrap(
    table('pierre_messages').upsert(
      {
        user_id: userId,
        household_id: householdId,
        rule_id: m.ruleId,
        dedupe_key: m.dedupeKey,
        severity: m.severity,
        title: m.title.slice(0, 200),
        body: m.body.slice(0, 600),
        data: m.data,
        last_seen_at: now,
        ...(patch.dismiss ? { dismissed_at: now } : {}),
        ...(patch.snoozeUntil ? { snoozed_until: patch.snoozeUntil } : {}),
      },
      { onConflict: 'user_id,dedupe_key' },
    ),
  );
}

/* ============================== Importação ============================== */
export interface ImportBatchSummary {
  batchId: string;
  repeatedFile: boolean;
  valid: number;
  invalid: number;
  duplicates: number;
}
export async function createImportBatch(p: {
  householdId: string;
  accountId: string | null;
  cardId: string | null;
  fileName: string;
  format: 'csv' | 'ofx';
  fileHash: string;
  mapping: Json;
  rows: NormalizedRow[];
}): Promise<ImportBatchSummary> {
  const r = await rpc<Json>('create_import_batch', {
    p_household_id: p.householdId,
    p_account_id: p.accountId,
    p_card_id: p.cardId,
    p_file_name: p.fileName,
    p_file_format: p.format,
    p_file_hash: p.fileHash,
    p_mapping: p.mapping,
    p_rows: p.rows.map((x) => ({
      row_number: x.rowNumber,
      raw: x.raw,
      occurred_on: x.occurredOn,
      description: x.description,
      amount_cents: x.amountCents,
      direction: x.direction,
      external_id: x.externalId,
      fingerprint: x.fingerprint,
      reject_reason: x.rejectReason,
    })),
  });
  return {
    batchId: r.batch_id,
    repeatedFile: r.repeated_file,
    valid: r.valid,
    invalid: r.invalid,
    duplicates: r.duplicates,
  };
}

export interface ImportRowView {
  id: string;
  rowNumber: number;
  occurredOn: ISODate | null;
  description: string | null;
  amountCents: Cents | null;
  direction: 'in' | 'out' | null;
  status: 'valid' | 'invalid' | 'duplicate' | 'review';
  rejectReason: string | null;
  include: boolean;
  categoryId: string | null;
  transactionId: string | null;
}
export async function loadImportRows(batchId: string): Promise<ImportRowView[]> {
  const rows = await fetchAll((a, b) =>
    getClient().from('import_rows').select('*').eq('batch_id', batchId).order('row_number').range(a, b),
  );
  return rows.map((r) => ({
    id: r.id,
    rowNumber: r.row_number,
    occurredOn: r.occurred_on ? String(r.occurred_on).slice(0, 10) : null,
    description: r.description,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    direction: r.direction,
    status: r.status,
    rejectReason: r.reject_reason,
    include: r.include,
    categoryId: r.category_id,
    transactionId: r.transaction_id,
  }));
}
export const confirmImport = (
  batchId: string,
  requestId: string,
  decisions: Array<{ row_id: string; include: boolean; category_id: string | null; description?: string }>,
) =>
  rpc<{ imported: number }>('confirm_import', {
    p_batch_id: batchId,
    p_request_id: requestId,
    p_decisions: decisions,
  });
export const cancelImport = (batchId: string) => rpc('cancel_import', { p_batch_id: batchId });
export const revertImport = (batchId: string) =>
  rpc<{ cancelled: number }>('revert_import', { p_batch_id: batchId });

export interface ImportBatchRow {
  id: string;
  fileName: string;
  format: string;
  status: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  invalidRows: number;
  createdAt: string;
  targetAccountId: string | null;
  targetCardId: string | null;
  createdBy: string;
}
export async function listImportBatches(householdId: string): Promise<ImportBatchRow[]> {
  const rows = await unwrap<Json[]>(
    getClient()
      .from('import_batches')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(50),
  );
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    format: r.file_format,
    status: r.status,
    totalRows: r.total_rows,
    importedRows: r.imported_rows,
    duplicateRows: r.duplicate_rows,
    invalidRows: r.invalid_rows,
    createdAt: r.created_at,
    targetAccountId: r.account_id,
    targetCardId: r.card_id,
    createdBy: r.created_by,
  }));
}
