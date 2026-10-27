import { isValidISODate, toISO, type ISODate } from '../dates';
import { parseMoneyInput, type Cents } from '../money/money';

export type Direction = 'in' | 'out';

export interface NormalizedRow {
  /** Posição no arquivo (1 = primeira linha de dados). */
  rowNumber: number;
  raw: Record<string, string>;
  occurredOn: ISODate | null;
  description: string | null;
  amountCents: Cents | null;
  direction: Direction | null;
  /** Identificador estável da origem (ex.: FITID do OFX). */
  externalId: string | null;
  rejectReason: string | null;
  /** Assinatura normalizada (inclui contador de ocorrência dentro do arquivo). */
  fingerprint: string | null;
}

export type DateFormat = 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd';
export type AmountFormat = 'auto' | 'br' | 'us';

/** Minúsculas, sem acentos, sem pontuação e com espaços colapsados — base da assinatura. */
export function normalizeDescription(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Detecta o formato de data olhando TODAS as amostras (um 13 no 1º campo decide dd/MM; no 2º, MM/dd). */
export function detectDateFormat(samples: readonly string[]): DateFormat {
  let dayFirstEvidence = false;
  let monthFirstEvidence = false;
  let iso = 0;
  for (const raw of samples) {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      iso++;
      continue;
    }
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirstEvidence = true;
    if (Number(m[2]) > 12) monthFirstEvidence = true;
  }
  if (iso > 0 && !dayFirstEvidence && !monthFirstEvidence && iso >= samples.length / 2) return 'yyyy-MM-dd';
  if (monthFirstEvidence && !dayFirstEvidence) return 'MM/dd/yyyy';
  return 'dd/MM/yyyy'; // padrão brasileiro quando ambíguo
}

export function parseImportDate(raw: string, format: DateFormat): ISODate | null {
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  if (format === 'yyyy-MM-dd') {
    const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!x) return null;
    [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])] as [number, number, number];
  } else {
    const x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?!\d)/.exec(s);
    if (!x) return null;
    const a = Number(x[1]);
    const b = Number(x[2]);
    y = x[3]!.length === 2 ? 2000 + Number(x[3]) : Number(x[3]);
    if (format === 'dd/MM/yyyy') [d, m] = [a, b];
    else [m, d] = [a, b];
  }
  const iso = toISO(y, m, d);
  if (!isValidISODate(iso)) return null;
  if (y < 1990 || y > 2100) return null;
  return iso;
}

/**
 * Valor monetário de arquivo → centavos COM sinal.
 * 'br' = vírgula decimal e ponto de milhar; 'us' = ponto decimal e vírgula de milhar;
 * 'auto' = se houver ponto E vírgula, o último separador é o decimal; se houver só um, assume formato BR
 * ("1.234" → 1234 reais, "12.50" → 12,50). Aceita "R$", parênteses, sinal final ("45,90-") e sufixo D/C.
 */
export function parseImportAmount(raw: string, format: AmountFormat = 'auto'): Cents | null {
  let s = raw.trim().replace(/\u00a0/g, ' ');
  if (!s) return null;
  let sign = 1;
  const suffix = /\s*([DdCc])$/.exec(s);
  if (suffix) {
    if (suffix[1]!.toLowerCase() === 'd') sign = -1;
    s = s.slice(0, suffix.index).trim();
  }
  if (s.endsWith('-')) {
    sign = -1;
    s = s.slice(0, -1).trim();
  }
  let treatAs = format;
  if (format === 'auto') {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot !== -1 && lastComma !== -1) treatAs = lastDot > lastComma ? 'us' : 'br';
    else treatAs = 'br';
  }
  if (treatAs === 'us') s = s.replace(/,/g, '').replace(/\./, ',');
  const cents = parseMoneyInput(s);
  if (cents === null) return null;
  return cents * sign;
}

/** Hash não criptográfico de 53 bits (cyrb53). Serve só para assinatura de deduplicação. */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashText(text: string): string {
  return [cyrb53(text, 1), cyrb53(text, 2), cyrb53(text, 3)]
    .map((n) => n.toString(16).padStart(14, '0'))
    .join('');
}

export function fingerprintBase(
  row: Pick<NormalizedRow, 'occurredOn' | 'direction' | 'amountCents' | 'description'>,
): string {
  return hashText(
    [row.occurredOn, row.direction, row.amountCents, normalizeDescription(row.description ?? '')].join('|'),
  );
}

/**
 * Preenche `fingerprint` das linhas válidas. Linhas IDÊNTICAS no mesmo arquivo recebem sufixo #1, #2…
 * Assim, duas compras legítimas iguais no mesmo dia continuam distintas e, ao reimportar o mesmo arquivo,
 * cada uma casa com a sua — nada é descartado por "parecer igual".
 */
export function assignFingerprints(rows: NormalizedRow[]): NormalizedRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.rejectReason || r.occurredOn === null || r.amountCents === null || r.direction === null) {
      return { ...r, fingerprint: null };
    }
    const base = fingerprintBase(r);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, fingerprint: `${base}#${n}` };
  });
}

/** Linhas que se repetem DENTRO do arquivo (mesma assinatura base) — avisadas, nunca removidas. */
export function repeatedInFile(rows: readonly NormalizedRow[]): Set<number> {
  const out = new Set<number>();
  for (const r of rows) {
    if (r.fingerprint && !r.fingerprint.endsWith('#1')) out.add(r.rowNumber);
    if (r.fingerprint?.endsWith('#1')) {
      const base = r.fingerprint.slice(0, -2);
      if (rows.some((o) => o.fingerprint === `${base}#2`)) out.add(r.rowNumber);
    }
  }
  return out;
}

export function emptyRow(
  rowNumber: number,
  raw: Record<string, string>,
  rejectReason: string,
): NormalizedRow {
  return {
    rowNumber,
    raw,
    occurredOn: null,
    description: null,
    amountCents: null,
    direction: null,
    externalId: null,
    rejectReason,
    fingerprint: null,
  };
}
