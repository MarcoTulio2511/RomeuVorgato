import { addDays, addMonthsClamped, compareISO, weekday, type ISODate } from '../dates';
import type { RecurringRule, WeekendRule } from '../types';

export interface Occurrence {
  /** Data teórica da regra (âncora estável; compõe a chave de idempotência). */
  scheduled: ISODate;
  /** Data efetiva após a regra de fim de semana. */
  due: ISODate;
  key: string;
}

type RuleShape = Pick<
  RecurringRule,
  'id' | 'frequency' | 'intervalCount' | 'startDate' | 'endDate' | 'weekendRule'
>;

/**
 * Ajuste de fim de semana (feriados NÃO são considerados — limitação documentada):
 *  - none: mantém;
 *  - previous_business_day: sábado→sexta, domingo→sexta;
 *  - next_business_day: sábado→segunda, domingo→segunda.
 */
export function adjustForWeekend(date: ISODate, rule: WeekendRule): ISODate {
  if (rule === 'none') return date;
  const wd = weekday(date);
  if (wd === 6) return addDays(date, rule === 'previous_business_day' ? -1 : 2);
  if (wd === 0) return addDays(date, rule === 'previous_business_day' ? -2 : 1);
  return date;
}

function nth(rule: RuleShape, k: number): ISODate {
  const n = Math.max(1, rule.intervalCount);
  switch (rule.frequency) {
    case 'weekly':
      return addDays(rule.startDate, 7 * n * k);
    case 'biweekly':
      return addDays(rule.startDate, 14 * n * k);
    case 'monthly':
      // sempre a partir da âncora (start_date) → dia 31 não "deriva" para 28 depois de fevereiro
      return addMonthsClamped(rule.startDate, n * k);
    case 'yearly':
      return addMonthsClamped(rule.startDate, 12 * n * k);
  }
}

/** Ocorrências cuja data efetiva cai em [from, to]. Determinística e sem estado. */
export function occurrencesBetween(rule: RuleShape, from: ISODate, to: ISODate): Occurrence[] {
  const out: Occurrence[] = [];
  const limit = addDays(to, 3); // folga para o ajuste de fim de semana
  for (let k = 0; k < 5000; k++) {
    const scheduled = nth(rule, k);
    if (compareISO(scheduled, limit) > 0) break;
    if (rule.endDate && compareISO(scheduled, rule.endDate) > 0) break;
    const due = adjustForWeekend(scheduled, rule.weekendRule);
    if (compareISO(due, from) < 0 || compareISO(due, to) > 0) continue;
    out.push({ scheduled, due, key: `${rule.id}:${scheduled}` });
  }
  return out;
}
