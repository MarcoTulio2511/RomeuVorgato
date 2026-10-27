import type { ISODate } from '../dates';
import type { BudgetUsage, OrdersFit } from '../budgets/budgets';
import type { InvoiceStatus, InvoiceTotals } from '../invoices/invoices';
import type { FreeCashResult, Horizon } from '../projections/freeCash';
import type { Cents } from '../money/money';
import type { Budget, Invoice, PlannedTransaction } from '../types';

export type Severity = 'positive' | 'info' | 'warning' | 'critical';

export interface PierrePrefs {
  enabled: boolean;
  /** Mínimo de meses comparáveis para qualquer análise de variação histórica. */
  minPeriods: number;
  /** Variação (%) acima da média que dispara o aviso de gasto fora do padrão. */
  variancePct: number;
}

export interface BudgetView {
  budget: Budget;
  categoryName: string;
  usage: BudgetUsage;
  orders: OrdersFit | null;
}

export interface InvoiceView {
  invoice: Invoice;
  cardName: string;
  totals: InvoiceTotals;
  status: InvoiceStatus;
}

export interface CategoryTrend {
  categoryId: string;
  name: string;
  currentSpentCents: Cents;
  /** Média dos meses completos anteriores (centavos, divisão inteira). */
  averagePastCents: Cents;
  /** Quantidade de meses completos comparáveis usados na média. */
  periods: number;
}

export interface PierreInput {
  today: ISODate;
  prefs: PierrePrefs;
  budgets: BudgetView[];
  invoices: InvoiceView[];
  freeCash: FreeCashResult | null;
  horizon: Horizon | null;
  nextIncome: PlannedTransaction | null;
  upcomingSubscriptions: PlannedTransaction[];
  trends: CategoryTrend[];
  /** Meses completos de histórico disponíveis na casa (do primeiro lançamento até o mês anterior). */
  historyPeriods: number;
  savings: { goalCents: Cents; savedCents: Cents } | null;
  hasAnyData: boolean;
}

export interface PierreMessage {
  ruleId: string;
  /** Uma mensagem por tópico: regras do mesmo tópico competem e só a de maior prioridade sobrevive. */
  topic: string;
  /** Chave de deduplicação/frequência (inclui o período, para reaparecer no mês seguinte). */
  dedupeKey: string;
  severity: Severity;
  priority: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
  /** Horas até repetir como destaque; 0 = sempre elegível. */
  cooldownHours: number;
}

export interface MessageHistoryEntry {
  lastShownAt?: string;
  dismissedAt?: string | null;
  snoozedUntil?: string | null;
}
export type MessageHistory = Record<string, MessageHistoryEntry>;

export interface PierreAnswer {
  question: string;
  verdict: 'yes' | 'caution' | 'no' | 'info';
  headline: string;
  /** Regra utilizada para chegar à resposta (transparência). */
  rule: string;
  values: Array<{ label: string; cents: Cents }>;
  /** Compromissos considerados, quando relevante. */
  considered: Array<{ label: string; dueDate: ISODate; cents: Cents }>;
  notes: string[];
}
