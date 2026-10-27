/**
 * Dinheiro sempre como inteiro em centavos. Nenhuma soma/divisão financeira usa ponto flutuante.
 * Ponto flutuante só aparece em `formatBRL` (exibição) e em razões percentuais para barras de progresso.
 */
export type Cents = number;

/** Limite de segurança (R$ 100 bilhões) — bem abaixo de Number.MAX_SAFE_INTEGER e de bigint do banco. */
export const MAX_CENTS = 10_000_000_000_000;

export class MoneyError extends Error {}

export function assertCents(value: number, label = 'valor'): Cents {
  if (!Number.isSafeInteger(value)) throw new MoneyError(`${label} deve ser um número inteiro de centavos`);
  if (Math.abs(value) > MAX_CENTS) throw new MoneyError(`${label} excede o limite permitido`);
  return value;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total, 'soma');
}

/**
 * Converte texto digitado (formato brasileiro) em centavos, sem usar float.
 * Aceita "1.234,56", "1234,56", "1234.56", "12,5", "R$ 10", "1.234" (milhar).
 * Retorna null quando ambíguo/inválido.
 */
export function parseMoneyInput(raw: string): Cents | null {
  let s = raw.replace(/R\$/gi, '').replace(/[\s\u00a0]/g, '');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;

  let intPart: string;
  let fracPart = '';
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1) {
    // vírgula é o separador decimal; pontos só podem ser milhar
    intPart = s.slice(0, lastComma);
    fracPart = s.slice(lastComma + 1);
    if (intPart.includes(',')) return null;
    if (intPart.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(intPart)) return null;
    intPart = intPart.replace(/\./g, '');
  } else if (lastDot !== -1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      intPart = s.replace(/\./g, ''); // "1.234" / "1.234.567" => milhar
    } else if (s.indexOf('.') === lastDot) {
      intPart = s.slice(0, lastDot);
      fracPart = s.slice(lastDot + 1);
    } else {
      return null;
    }
  } else {
    intPart = s;
  }

  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || (fracPart !== '' && !/^\d{1,2}$/.test(fracPart))) return null;
  if (intPart.length > 13) return null;
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return negative ? -cents : cents;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Exibição: recebe centavos já calculados. */
export function formatBRL(cents: Cents): string {
  return brl.format(assertCents(cents) / 100).replace(/\u00a0/g, ' ');
}

export function formatBRLCompact(cents: Cents): string {
  return compact.format(assertCents(cents) / 100).replace(/\u00a0/g, ' ');
}

/** "1.234,56" — para preencher inputs. */
export function formatMoneyInput(cents: Cents): string {
  return plain.format(assertCents(cents) / 100);
}

/**
 * Divide `total` em `count` partes inteiras somando exatamente `total`.
 * Regra determinística (idêntica à do banco): cada parcela recebe floor(total/count) e os
 * `total mod count` centavos restantes vão, um a um, para as primeiras parcelas.
 */
export function splitCents(total: Cents, count: number): Cents[] {
  assertCents(total);
  if (!Number.isInteger(count) || count < 1) throw new MoneyError('Quantidade de parcelas inválida');
  if (total < 0) throw new MoneyError('Não é possível dividir valor negativo');
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Percentual (0–100+) apenas para exibição/barras. Nunca use para decidir somas. */
export function ratioPercent(part: Cents, whole: Cents): number {
  if (whole <= 0) return part > 0 ? 100 : 0;
  return (part / whole) * 100;
}

export function maxCents(a: Cents, b: Cents): Cents {
  return a > b ? a : b;
}

export function minCents(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}
