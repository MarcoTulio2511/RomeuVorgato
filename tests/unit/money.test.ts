import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  assertCents,
  formatBRL,
  formatMoneyInput,
  parseMoneyInput,
  splitCents,
  sumCents,
} from '../../src/domain/money/money';

describe('parseMoneyInput (formato brasileiro, sem float)', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['R$ 1.234,56', 123456],
    ['1234.56', 123456],
    ['12,5', 1250],
    ['0,07', 7],
    [',99', 99],
    ['10', 1000],
    ['1.234', 123400], // 3 dígitos após ponto = milhar
    ['1.234.567,89', 123456789],
    ['-45,90', -4590],
    ['(45,90)', -4590],
    ['0,10', 10],
    ['19,99', 1999],
  ])('%s -> %d', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '1.2.3,4', '12,345', '1.23.456', '99999999999999,00'])(
    'rejeita ambíguo/inválido: %s',
    (input) => {
      expect(parseMoneyInput(input)).toBeNull();
    },
  );

  it('não sofre erro de ponto flutuante (0,29 e 1,15)', () => {
    expect(parseMoneyInput('0,29')).toBe(29); // 0.29*100 = 28.999999… em float
    expect(parseMoneyInput('1,15')).toBe(115);
    expect(parseMoneyInput('4,35')).toBe(435);
  });
});

describe('formatBRL', () => {
  it('formata em pt-BR', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(-5)).toMatch(/-R\$ 0,05|R\$ -0,05/);
    expect(formatMoneyInput(100)).toBe('1,00');
  });
});

describe('splitCents', () => {
  it('distribui centavos restantes nas primeiras parcelas e soma exatamente o total', () => {
    expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitCents(100, 7)).toEqual([15, 15, 14, 14, 14, 14, 14]);
    expect(splitCents(1, 1)).toEqual([1]);
  });

  it('soma sempre igual ao total para muitos casos', () => {
    for (let total = 1; total < 700; total += 13) {
      for (let n = 1; n <= 24; n++) {
        const parts = splitCents(total, n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rejeita entradas inválidas', () => {
    expect(() => splitCents(100, 0)).toThrow(MoneyError);
    expect(() => splitCents(-1, 2)).toThrow(MoneyError);
    expect(() => splitCents(10.5, 2)).toThrow(MoneyError);
  });
});

describe('validação de centavos', () => {
  it('só aceita inteiros seguros dentro do limite', () => {
    expect(() => assertCents(1.5)).toThrow();
    expect(() => assertCents(Number.NaN)).toThrow();
    expect(() => assertCents(1e15)).toThrow();
    expect(sumCents([10, 20, 30])).toBe(60);
  });
});
