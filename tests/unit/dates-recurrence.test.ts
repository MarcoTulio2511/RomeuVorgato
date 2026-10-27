import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  clampedDate,
  diffDays,
  endOfMonth,
  isValidISODate,
  weekday,
} from '../../src/domain/dates';
import { adjustForWeekend, occurrencesBetween } from '../../src/domain/projections/recurrence';
import { recurring } from '../helpers/factories';

describe('datas em meses curtos', () => {
  it('limita o dia ao fim do mês', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29'); // bissexto
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonthsClamped('2026-12-15', 2)).toBe('2027-02-15');
    expect(clampedDate(2026, 14, 31)).toBe('2027-02-28');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
  });

  it('valida datas e calcula diferenças', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-03-01', '2026-02-01')).toBe(28);
  });
});

describe('recorrências', () => {
  it('sanidade do calendário usado nos testes: 07/03/2026 é sábado', () => {
    expect(weekday('2026-03-07')).toBe(6);
    expect(weekday('2026-03-08')).toBe(0);
  });

  it('mensal no dia 31 não "deriva": fev=28, mar=31, abr=30, mai=31', () => {
    const r = recurring({ startDate: '2026-01-31' });
    const occ = occurrencesBetween(r, '2026-01-01', '2026-05-31').map((o) => o.due);
    expect(occ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('filtra pela janela [from, to]', () => {
    const r = recurring({ startDate: '2026-01-05' });
    expect(occurrencesBetween(r, '2026-02-01', '2026-03-31').map((o) => o.due)).toEqual([
      '2026-02-05',
      '2026-03-05',
    ]);
  });

  it('respeita data final e intervalo', () => {
    const r = recurring({ startDate: '2026-01-10', endDate: '2026-04-30', intervalCount: 2 });
    expect(occurrencesBetween(r, '2026-01-01', '2026-12-31').map((o) => o.due)).toEqual([
      '2026-01-10',
      '2026-03-10',
    ]);
  });

  it('semanal e quinzenal', () => {
    const w = recurring({ frequency: 'weekly', startDate: '2026-03-02' });
    expect(occurrencesBetween(w, '2026-03-01', '2026-03-20').map((o) => o.due)).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
    ]);
    const b = recurring({ frequency: 'biweekly', startDate: '2026-03-02' });
    expect(occurrencesBetween(b, '2026-03-01', '2026-04-01').map((o) => o.due)).toEqual([
      '2026-03-02',
      '2026-03-16',
      '2026-03-30',
    ]);
  });

  it('anual em 29/02 cai em 28/02 nos anos não bissextos', () => {
    const r = recurring({ frequency: 'yearly', startDate: '2024-02-29' });
    expect(occurrencesBetween(r, '2025-01-01', '2028-12-31').map((o) => o.due)).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('fim de semana: dia útil anterior/seguinte; chave usa a data teórica (estável)', () => {
    expect(adjustForWeekend('2026-03-07', 'previous_business_day')).toBe('2026-03-06');
    expect(adjustForWeekend('2026-03-08', 'previous_business_day')).toBe('2026-03-06');
    expect(adjustForWeekend('2026-03-07', 'next_business_day')).toBe('2026-03-09');
    expect(adjustForWeekend('2026-03-08', 'next_business_day')).toBe('2026-03-09');
    expect(adjustForWeekend('2026-03-07', 'none')).toBe('2026-03-07');
    const r = recurring({ id: 'r1', startDate: '2026-03-07', weekendRule: 'next_business_day' });
    const [o] = occurrencesBetween(r, '2026-03-01', '2026-03-31');
    expect(o).toMatchObject({ scheduled: '2026-03-07', due: '2026-03-09', key: 'r1:2026-03-07' });
  });

  it('é determinística: duas execuções geram exatamente as mesmas chaves (idempotência)', () => {
    const r = recurring({ id: 'r2' });
    const a = occurrencesBetween(r, '2026-01-01', '2026-12-31').map((o) => o.key);
    const b = occurrencesBetween(r, '2026-01-01', '2026-12-31').map((o) => o.key);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});
