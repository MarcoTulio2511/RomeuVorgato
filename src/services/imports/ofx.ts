import { parseSync } from 'ofx-js';
import {
  assignFingerprints,
  emptyRow,
  parseImportAmount,
  type NormalizedRow,
} from '../../domain/imports/normalize';
import { isValidISODate, toISO } from '../../domain/dates';

export class ImportFileError extends Error {}

type Obj = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export interface OfxStatement {
  kind: 'bank' | 'card';
  currency: string;
  accountId: string | null;
  rows: NormalizedRow[];
}

/** "20260310120000[-3:BRT]" / "20260310" → "2026-03-10". */
export function parseOfxDate(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const iso = toISO(Number(m[1]), Number(m[2]), Number(m[3]));
  return isValidISODate(iso) ? iso : null;
}

/**
 * Interpreta OFX (SGML 1.x e XML 2.x) com a biblioteca `ofx-js`. Lê extratos bancários (STMTRS) e de cartão
 * (CCSTMTRS). Direção pelo sinal de TRNAMT (negativo = saída). FITID vira identificador externo.
 * Limitações: não interpreta investimentos (INVSTMTMSGSRSV1) nem multimoeda — moeda diferente de BRL é rejeitada.
 */
export function parseOfxText(text: string): OfxStatement[] {
  if (!/<OFX[\s>]/i.test(text) && !/OFXHEADER/i.test(text)) {
    throw new ImportFileError('O arquivo não parece ser um OFX válido.');
  }
  let parsed;
  try {
    parsed = parseSync(text);
  } catch {
    throw new ImportFileError('Não foi possível interpretar o OFX. O arquivo pode estar corrompido.');
  }
  const ofx = asObj(parsed.OFX);
  const statements: OfxStatement[] = [];

  const collect = (kind: 'bank' | 'card', trnRs: unknown, stmtKey: string, listKey: 'BANKTRANLIST') => {
    for (const rs of asArray(trnRs)) {
      const stmt = asObj(asObj(rs)[stmtKey]);
      if (Object.keys(stmt).length === 0) continue;
      const currency = str(stmt['CURDEF']) || 'BRL';
      const acct = asObj(stmt[kind === 'bank' ? 'BANKACCTFROM' : 'CCACCTFROM']);
      const list = asObj(stmt[listKey]);
      const rows = asArray(list['STMTTRN']).map((t, i) => normalizeTransaction(asObj(t), i + 1));
      statements.push({ kind, currency, accountId: str(acct['ACCTID']) || null, rows });
    }
  };

  collect('bank', asObj(ofx['BANKMSGSRSV1'])['STMTTRNRS'], 'STMTRS', 'BANKTRANLIST');
  collect('card', asObj(ofx['CREDITCARDMSGSRSV1'])['CCSTMTTRNRS'], 'CCSTMTRS', 'BANKTRANLIST');

  if (statements.length === 0) {
    throw new ImportFileError('Nenhum extrato bancário ou de cartão foi encontrado no OFX.');
  }
  return statements;
}

function normalizeTransaction(t: Obj, rowNumber: number): NormalizedRow {
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) if (typeof v === 'string') raw[k] = v;

  const date = parseOfxDate(str(t['DTPOSTED']) || str(t['DTUSER']));
  if (!date) return emptyRow(rowNumber, raw, `Data inválida: "${str(t['DTPOSTED'])}"`);

  const amount = parseImportAmount(str(t['TRNAMT']), 'auto');
  if (amount === null) return emptyRow(rowNumber, raw, `Valor inválido: "${str(t['TRNAMT'])}"`);
  if (amount === 0) return emptyRow(rowNumber, raw, 'Valor zero');

  const name = str(t['NAME']);
  const memo = str(t['MEMO']);
  const description = (
    name && memo && !memo.toLowerCase().includes(name.toLowerCase()) ? `${name} - ${memo}` : name || memo
  )
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  if (!description) return emptyRow(rowNumber, raw, 'Descrição vazia');

  return {
    rowNumber,
    raw,
    occurredOn: date,
    description,
    amountCents: Math.abs(amount),
    direction: amount < 0 ? 'out' : 'in',
    externalId: str(t['FITID']).slice(0, 120) || null,
    rejectReason: null,
    fingerprint: null,
  };
}

/** Une os extratos do arquivo numa lista única (rowNumber contínuo) e calcula as assinaturas. */
export function flattenOfx(statements: OfxStatement[]): { rows: NormalizedRow[]; currency: string } {
  const currencies = new Set(statements.map((s) => s.currency.toUpperCase()));
  if ([...currencies].some((c) => c !== 'BRL')) {
    throw new ImportFileError('Este OFX usa moeda diferente de BRL, que não é suportada.');
  }
  let n = 0;
  const rows = statements.flatMap((s) => s.rows).map((r) => ({ ...r, rowNumber: ++n }));
  return { rows: assignFingerprints(rows), currency: 'BRL' };
}
