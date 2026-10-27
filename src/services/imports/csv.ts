import Papa from 'papaparse';
import {
  assignFingerprints,
  detectDateFormat,
  emptyRow,
  normalizeDescription,
  parseImportAmount,
  parseImportDate,
  type AmountFormat,
  type DateFormat,
  type NormalizedRow,
} from '../../domain/imports/normalize';

export interface CsvTable {
  delimiter: string;
  headers: string[];
  rows: string[][];
  hasHeader: boolean;
  warnings: string[];
}

export type SignRule = 'negative_is_expense' | 'positive_is_expense';

export interface CsvMapping {
  date: number;
  description: number;
  /** Coluna única de valor (com sinal) — ou use débito/crédito separados. */
  amount: number | null;
  debit: number | null;
  credit: number | null;
  /** Coluna de tipo (Débito/Crédito, D/C, Entrada/Saída). */
  type: number | null;
  externalId: number | null;
}

export interface CsvOptions {
  dateFormat: DateFormat | 'auto';
  amountFormat: AmountFormat;
  signRule: SignRule;
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
  dateFormat: 'auto',
  amountFormat: 'auto',
  signRule: 'negative_is_expense',
};

const CANDIDATE_DELIMITERS = [';', ',', '\t', '|'];

/** Escolhe o delimitador cujo número de colunas é mais consistente nas primeiras linhas. */
export function detectDelimiter(text: string): string {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 15);
  let best = ';';
  let bestScore = -1;
  for (const d of CANDIDATE_DELIMITERS) {
    const counts = lines.map((l) => Papa.parse<string[]>(l, { delimiter: d }).data[0]?.length ?? 1);
    const modal = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 1;
    if (modal < 2) continue;
    const consistent = counts.filter((c) => c === modal).length;
    const score = consistent * 100 + modal;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function cellsLookLikeData(row: string[]): boolean {
  return row.some(
    (c) => parseImportDate(c, 'dd/MM/yyyy') !== null || parseImportDate(c, 'yyyy-MM-dd') !== null,
  );
}

export function parseCsvText(text: string, opts: { delimiter?: string; hasHeader?: boolean } = {}): CsvTable {
  const clean = text.replace(/^\uFEFF/, '');
  const delimiter = opts.delimiter ?? detectDelimiter(clean);
  const result = Papa.parse<string[]>(clean, { delimiter, skipEmptyLines: 'greedy' });
  const warnings = result.errors
    .filter((e) => e.type !== 'Delimiter')
    .map((e) => `Linha ${e.row ?? '?'}: ${e.message}`);
  const data = result.data.map((r) => r.map((c) => (c ?? '').trim()));
  const first = data[0] ?? [];
  const hasHeader = opts.hasHeader ?? !cellsLookLikeData(first);
  const width = Math.max(0, ...data.map((r) => r.length));
  const headers = hasHeader
    ? Array.from({ length: width }, (_, i) => first[i] || `Coluna ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Coluna ${i + 1}`);
  return { delimiter, headers, rows: hasHeader ? data.slice(1) : data, hasHeader, warnings };
}

const norm = (s: string) => normalizeDescription(s);

/** Sugere o mapeamento pelos nomes das colunas (o usuário sempre pode corrigir). */
export function guessMapping(headers: readonly string[]): Partial<CsvMapping> {
  const find = (re: RegExp, skip: number[] = []) => {
    const i = headers.findIndex((h, idx) => !skip.includes(idx) && re.test(norm(h)));
    return i === -1 ? null : i;
  };
  const date = find(/\b(data|date|dt)\b/);
  const debit = find(/\b(debito|debit|saida)\b/);
  const credit = find(/\b(credito|credit|entrada)\b/, debit === null ? [] : [debit]);
  const type = find(/\b(tipo|type|natureza|dc)\b/);
  const description = find(/(descri|historico|memo|lancamento|estabelecimento|title|titulo|detalhe|nome)/);
  const amount = find(/\b(valor|amount|value|montante|quantia)\b/);
  const externalId = find(/\b(id|identificador|fitid|documento|doc|nsu|autorizacao|protocolo)\b/);
  const out: Partial<CsvMapping> = { debit, credit, type, amount, externalId };
  if (date !== null) out.date = date;
  if (description !== null) out.description = description;
  return out;
}

const OUT_RE = /^(d|deb|debito|saida|out|expense|despesa|compra|pagamento)\b/;
const IN_RE = /^(c|cred|credito|entrada|in|income|receita|estorno)\b/;

export interface CsvNormalizeResult {
  rows: NormalizedRow[];
  dateFormat: DateFormat;
}

/** Converte linhas brutas em linhas normalizadas conforme mapeamento e opções. Nunca lança por dado ruim. */
export function normalizeCsv(table: CsvTable, mapping: CsvMapping, options: CsvOptions): CsvNormalizeResult {
  const dateFormat =
    options.dateFormat === 'auto'
      ? detectDateFormat(table.rows.map((r) => r[mapping.date] ?? ''))
      : options.dateFormat;
  const cell = (r: string[], i: number | null) => (i === null ? '' : (r[i] ?? '').trim());

  const rows = table.rows.map((r, idx): NormalizedRow => {
    const rowNumber = idx + 1;
    const raw: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      raw[h] = r[i] ?? '';
    });

    const occurredOn = parseImportDate(cell(r, mapping.date), dateFormat);
    if (!occurredOn) return emptyRow(rowNumber, raw, `Data inválida: "${cell(r, mapping.date)}"`);

    const description = cell(r, mapping.description).replace(/\s+/g, ' ').slice(0, 200);
    if (!description) return emptyRow(rowNumber, raw, 'Descrição vazia');

    let signed: number;
    let direction: 'in' | 'out';

    if (mapping.debit !== null || mapping.credit !== null) {
      const d = cell(r, mapping.debit)
        ? parseImportAmount(cell(r, mapping.debit), options.amountFormat)
        : null;
      const c = cell(r, mapping.credit)
        ? parseImportAmount(cell(r, mapping.credit), options.amountFormat)
        : null;
      if (d !== null && d !== 0 && c !== null && c !== 0)
        return emptyRow(rowNumber, raw, 'Débito e crédito preenchidos na mesma linha');
      if (d !== null && d !== 0) {
        signed = Math.abs(d);
        direction = 'out';
      } else if (c !== null && c !== 0) {
        signed = Math.abs(c);
        direction = 'in';
      } else {
        return emptyRow(rowNumber, raw, 'Valor ausente ou zero');
      }
    } else if (mapping.amount !== null) {
      const v = parseImportAmount(cell(r, mapping.amount), options.amountFormat);
      if (v === null) return emptyRow(rowNumber, raw, `Valor inválido: "${cell(r, mapping.amount)}"`);
      if (v === 0) return emptyRow(rowNumber, raw, 'Valor zero');
      if (mapping.type !== null) {
        const t = norm(cell(r, mapping.type));
        if (OUT_RE.test(t)) direction = 'out';
        else if (IN_RE.test(t)) direction = 'in';
        else return emptyRow(rowNumber, raw, `Tipo não reconhecido: "${cell(r, mapping.type)}"`);
        signed = Math.abs(v);
      } else {
        const outIsNegative = options.signRule === 'negative_is_expense';
        direction = v < 0 === outIsNegative ? 'out' : 'in';
        signed = Math.abs(v);
      }
    } else {
      return emptyRow(rowNumber, raw, 'Nenhuma coluna de valor foi mapeada');
    }

    return {
      rowNumber,
      raw,
      occurredOn,
      description,
      amountCents: signed,
      direction,
      externalId: cell(r, mapping.externalId).slice(0, 120) || null,
      rejectReason: null,
      fingerprint: null,
    };
  });

  return { rows: assignFingerprints(rows), dateFormat };
}
