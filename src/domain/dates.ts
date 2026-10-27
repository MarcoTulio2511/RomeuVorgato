/**
 * Datas de calendário como strings ISO "YYYY-MM-DD" (sem fuso horário).
 * Toda a aritmética usa Date.UTC apenas como calendário, evitando deslocamentos de fuso/horário de verão.
 */
export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidISODate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseISO(value: ISODate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(value);
  if (!m || !isValidISODate(value)) throw new RangeError(`Data inválida: ${value}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Monta uma data limitando o dia ao último dia do mês (ex.: dia 31 em fevereiro vira 28/29). */
export function clampedDate(y: number, m: number, day: number): ISODate {
  // normaliza meses fora de 1..12
  const idx = y * 12 + (m - 1);
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return toISO(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toUTC(iso: ISODate): number {
  const { y, m, d } = parseISO(iso);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fromUTC(toUTC(iso) + n * 86_400_000);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a) - toUTC(b)) / 86_400_000);
}

/** Soma meses mantendo o dia, limitado ao fim do mês de destino. */
export function addMonthsClamped(iso: ISODate, n: number): ISODate {
  const { y, m, d } = parseISO(iso);
  return clampedDate(y, m + n, d);
}

/** 0 = domingo … 6 = sábado. */
export function weekday(iso: ISODate): number {
  return new Date(toUTC(iso)).getUTCDay();
}

export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function startOfMonth(iso: ISODate): ISODate {
  const { y, m } = parseISO(iso);
  return toISO(y, m, 1);
}

export function endOfMonth(iso: ISODate): ISODate {
  const { y, m } = parseISO(iso);
  return toISO(y, m, daysInMonth(y, m));
}

export function addMonthKey(key: string, n: number): string {
  return monthKey(addMonthsClamped(`${key}-01`, n));
}

export function monthRange(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let k = fromKey;
  while (k <= toKey && out.length < 600) {
    out.push(k);
    k = addMonthKey(k, 1);
  }
  return out;
}

/** Data local do usuário (não UTC) como ISO. Único ponto que lê o relógio. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function formatDateBR(iso: ISODate): string {
  const { y, m, d } = parseISO(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function formatDayMonthBR(iso: ISODate): string {
  return formatDateBR(iso).slice(0, 5);
}

const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function formatMonthLabel(key: string, short = false): string {
  const { y, m } = parseISO(`${key}-01`);
  const name = MONTHS_PT[m - 1] ?? '';
  const label = short ? name.slice(0, 3) : name;
  return `${label}/${short ? String(y).slice(2) : y}`;
}
