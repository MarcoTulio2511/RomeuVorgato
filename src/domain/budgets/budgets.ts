import { daysInMonth, endOfMonth, parseISO, startOfMonth, compareISO, type ISODate } from '../dates';
import type { Cents } from '../money/money';
import type { Budget, Category } from '../types';
import { inRange, type SpendingEvent } from './spending';

export type BudgetStatus = 'healthy' | 'warning' | 'exceeded';

export interface BudgetUsage {
  limitCents: Cents;
  /** Gasto líquido: gastos − estornos da categoria (e subcategorias) no mês. */
  spentCents: Cents;
  remainingCents: Cents;
  overCents: Cents;
  status: BudgetStatus;
  /** Projeção linear até o fim do mês; null quando não há base suficiente (poucos dias) ou o mês já acabou. */
  projectedCents: Cents | null;
  willExceed: boolean;
  /** Eventos que compõem o valor usado — a UI os exibe para explicar o número. */
  lines: SpendingEvent[];
}

/** Categoria + todas as descendentes (subcategorias contam no orçamento da categoria-pai). */
export function categoryFamily(categories: readonly Category[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function budgetAppliesTo(budget: Budget, monthKey: string): boolean {
  if (!budget.isActive) return false;
  const first = `${monthKey}-01`;
  const last = endOfMonth(first);
  if (compareISO(startOfMonth(budget.startsOn), first) > 0) return false;
  if (budget.endsOn && compareISO(budget.endsOn, first) < 0) return false;
  return compareISO(first, last) <= 0;
}

export const MIN_DAYS_FOR_PROJECTION = 5;

/**
 * Disponível = limite − gasto líquido da categoria no mês, pela base do orçamento.
 * Orçamento pessoal (ownerId) só conta gastos desse titular; compartilhado (null) conta todos.
 */
export function budgetUsage(
  budget: Budget,
  events: readonly SpendingEvent[],
  categories: readonly Category[],
  monthKey: string,
  today: ISODate,
): BudgetUsage {
  const family = categoryFamily(categories, budget.categoryId);
  const first = `${monthKey}-01`;
  const last = endOfMonth(first);
  const lines = events.filter(
    (e) =>
      e.categoryId !== null &&
      family.has(e.categoryId) &&
      inRange(e.date, first, last) &&
      (budget.ownerId === null || e.ownerId === budget.ownerId),
  );
  const spent = lines.reduce((acc, e) => acc + e.amountCents, 0);
  const remaining = budget.limitCents - spent;

  let status: BudgetStatus = 'healthy';
  if (spent > budget.limitCents) status = 'exceeded';
  else if (spent * 100 >= budget.limitCents * budget.alertPct) status = 'warning';

  let projected: Cents | null = null;
  const { y, m } = parseISO(first);
  const dim = daysInMonth(y, m);
  if (monthKey === today.slice(0, 7)) {
    const day = parseISO(today).d;
    if (day >= MIN_DAYS_FOR_PROJECTION) projected = Math.floor((spent * dim + Math.floor(day / 2)) / day);
  } else if (compareISO(last, today) < 0) {
    projected = spent;
  }

  return {
    limitCents: budget.limitCents,
    spentCents: spent,
    remainingCents: remaining,
    overCents: Math.max(0, -remaining),
    status,
    projectedCents: projected,
    willExceed: projected !== null && projected > budget.limitCents,
    lines,
  };
}

export interface OrdersFit {
  /** Pedidos que cabem mesmo que TODOS custem o limite por pedido. */
  guaranteedOrders: number;
  /** Sobra após esses pedidos (cabe um pedido menor, de até esse valor). */
  leftoverCents: Cents;
  /** Valor máximo do próximo pedido: o menor entre o limite por pedido e o que resta. */
  nextOrderMaxCents: Cents;
}

/**
 * Quantos pedidos cabem no restante do orçamento respeitando o limite por pedido.
 * Não esconde a sobra: com R$ 50 restantes e limite de R$ 40 → 1 pedido garantido + R$ 10 de sobra.
 */
export function ordersThatFit(remainingCents: Cents, perOrderLimitCents: Cents): OrdersFit {
  if (perOrderLimitCents <= 0) return { guaranteedOrders: 0, leftoverCents: 0, nextOrderMaxCents: 0 };
  const remaining = Math.max(0, remainingCents);
  const guaranteed = Math.floor(remaining / perOrderLimitCents);
  return {
    guaranteedOrders: guaranteed,
    leftoverCents: remaining - guaranteed * perOrderLimitCents,
    nextOrderMaxCents: Math.min(perOrderLimitCents, remaining),
  };
}
