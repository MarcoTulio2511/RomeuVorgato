import { describe, expect, it } from 'vitest';
import {
  assignFingerprints,
  detectDateFormat,
  normalizeDescription,
  parseImportAmount,
  parseImportDate,
  repeatedInFile,
} from '../../src/domain/imports/normalize';
import {
  DEFAULT_CSV_OPTIONS,
  detectDelimiter,
  guessMapping,
  normalizeCsv,
  parseCsvText,
  type CsvMapping,
} from '../../src/services/imports/csv';
import { MAX_IMPORT_BYTES, decodeBytes, validateAndDecode } from '../../src/services/imports/file';
import { ImportFileError, flattenOfx, parseOfxText } from '../../src/services/imports/ofx';

const enc = (s: string) => new TextEncoder().encode(s);

describe('valores e datas de arquivos brasileiros', () => {
  it.each([
    ['1.234,56', 123456],
    ['-1.234,56', -123456],
    ['R$ 45,90', 4590],
    ['(45,90)', -4590],
    ['45,90-', -4590],
    ['45,90 D', -4590],
    ['45,90 C', 4590],
    ['1234.56', 123456], // ponto decimal (padrão US) detectado
    ['1,234.56', 123456], // US com milhar
    ['12.50', 1250],
    ['0,99', 99],
    ['1.000', 100000], // milhar BR, não 1,000
  ])('auto: %s -> %d', (input, expected) => {
    expect(parseImportAmount(input)).toBe(expected);
  });

  it('formato explícito resolve a ambiguidade', () => {
    expect(parseImportAmount('1,234', 'us')).toBe(123400);
    expect(parseImportAmount('1,234', 'br')).toBeNull(); // 3 casas após vírgula é inválido em BR
  });

  it('datas: dd/MM, MM/dd, ISO e ano com 2 dígitos', () => {
    expect(parseImportDate('05/03/2026', 'dd/MM/yyyy')).toBe('2026-03-05');
    expect(parseImportDate('05/03/2026', 'MM/dd/yyyy')).toBe('2026-05-03');
    expect(parseImportDate('2026-03-05', 'yyyy-MM-dd')).toBe('2026-03-05');
    expect(parseImportDate('05/03/26', 'dd/MM/yyyy')).toBe('2026-03-05');
    expect(parseImportDate('31/02/2026', 'dd/MM/yyyy')).toBeNull();
    expect(parseImportDate('', 'dd/MM/yyyy')).toBeNull();
  });

  it('detecta formato de data pelo conjunto de amostras', () => {
    expect(detectDateFormat(['01/02/2026', '13/02/2026'])).toBe('dd/MM/yyyy');
    expect(detectDateFormat(['01/02/2026', '02/13/2026'])).toBe('MM/dd/yyyy');
    expect(detectDateFormat(['01/02/2026', '03/04/2026'])).toBe('dd/MM/yyyy'); // ambíguo → padrão BR
    expect(detectDateFormat(['2026-02-01', '2026-02-13'])).toBe('yyyy-MM-dd');
  });
});

const CSV_BR = [
  'Data;Descrição;Valor;Identificador',
  '05/03/2026;Supermercado Pão de Açúcar;-1.234,56;A1',
  '06/03/2026;PIX recebido Maria;2.500,00;A2',
  '07/03/2026;Compra com data ruim;-10,00;A3',
  '31/02/2026;Data impossível;-10,00;A4',
  '08/03/2026;;-5,00;A5',
  '09/03/2026;Valor inválido;abc;A6',
].join('\n');

describe('CSV com formato brasileiro', () => {
  it('detecta ";" como delimitador e cabeçalho', () => {
    expect(detectDelimiter(CSV_BR)).toBe(';');
    const t = parseCsvText(CSV_BR);
    expect(t.hasHeader).toBe(true);
    expect(t.headers).toEqual(['Data', 'Descrição', 'Valor', 'Identificador']);
    expect(t.rows).toHaveLength(6);
  });

  it('vírgula decimal não é confundida com delimitador quando o delimitador é ";"', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
  });

  it('sugere mapeamento e normaliza: válidas, inválidas com motivo, valores exatos', () => {
    const t = parseCsvText(CSV_BR);
    const g = guessMapping(t.headers);
    expect(g).toMatchObject({ date: 0, description: 1, amount: 2, externalId: 3 });
    const mapping = { debit: null, credit: null, type: null, ...g } as CsvMapping;
    const { rows, dateFormat } = normalizeCsv(t, mapping, DEFAULT_CSV_OPTIONS);
    expect(dateFormat).toBe('dd/MM/yyyy');
    expect(rows[0]).toMatchObject({
      occurredOn: '2026-03-05',
      amountCents: 123456,
      direction: 'out',
      externalId: 'A1',
      rejectReason: null,
    });
    expect(rows[1]).toMatchObject({ amountCents: 250000, direction: 'in' });
    expect(rows[3]?.rejectReason).toMatch(/Data inválida/);
    expect(rows[4]?.rejectReason).toMatch(/Descrição vazia/);
    expect(rows[5]?.rejectReason).toMatch(/Valor inválido/);
    expect(rows.filter((r) => !r.rejectReason)).toHaveLength(3);
  });

  it('colunas separadas de débito e crédito, e coluna de tipo', () => {
    const t = parseCsvText(
      'Data;Histórico;Débito;Crédito\n01/03/2026;Luz;150,00;\n02/03/2026;Salário;;3.000,00',
    );
    const m = { ...guessMapping(t.headers), amount: null, type: null } as CsvMapping;
    const { rows } = normalizeCsv(t, m, DEFAULT_CSV_OPTIONS);
    expect(rows.map((r) => [r.direction, r.amountCents])).toEqual([
      ['out', 15000],
      ['in', 300000],
    ]);

    const t2 = parseCsvText(
      'Data;Descrição;Valor;Tipo\n01/03/2026;Mercado;100,00;Débito\n02/03/2026;Estorno;20,00;Crédito',
    );
    const m2 = { ...guessMapping(t2.headers), debit: null, credit: null } as CsvMapping;
    expect(normalizeCsv(t2, m2, DEFAULT_CSV_OPTIONS).rows.map((r) => r.direction)).toEqual(['out', 'in']);
  });

  it('regra de sinal invertida (cartões que exportam gasto como positivo)', () => {
    const t = parseCsvText('Data;Descrição;Valor\n01/03/2026;Loja;50,00\n02/03/2026;Estorno;-10,00');
    const m = { ...guessMapping(t.headers), debit: null, credit: null, type: null } as CsvMapping;
    const { rows } = normalizeCsv(t, m, { ...DEFAULT_CSV_OPTIONS, signRule: 'positive_is_expense' });
    expect(rows.map((r) => r.direction)).toEqual(['out', 'in']);
  });

  it('sem cabeçalho', () => {
    const t = parseCsvText('01/03/2026;Padaria;-12,50\n02/03/2026;Salário;1000,00');
    expect(t.hasHeader).toBe(false);
    expect(t.rows).toHaveLength(2);
  });
});

describe('OFX', () => {
  const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260331120000<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0001<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260301<DTEND>20260331
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305120000[-3:BRT]<TRNAMT>-1234.56<FITID>2026030501<MEMO>SUPERMERCADO PAO DE ACUCAR</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260306<TRNAMT>2500.00<FITID>2026030602<NAME>PIX RECEBIDO<MEMO>MARIA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260307<TRNAMT>-10,00<FITID>2026030703<MEMO>CAFE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260307<TRNAMT>-10,00<FITID>2026030704<MEMO>CAFE</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it('interpreta OFX SGML: FITID, sinal, datas com fuso e valores', () => {
    const [st] = parseOfxText(SGML);
    expect(st?.kind).toBe('bank');
    expect(st?.accountId).toBe('12345-6');
    const { rows } = flattenOfx([st!]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      occurredOn: '2026-03-05',
      amountCents: 123456,
      direction: 'out',
      externalId: '2026030501',
      description: 'SUPERMERCADO PAO DE ACUCAR',
    });
    expect(rows[1]).toMatchObject({
      direction: 'in',
      amountCents: 250000,
      description: 'PIX RECEBIDO - MARIA',
    });
    expect(rows[2]).toMatchObject({ amountCents: 1000, direction: 'out' }); // vírgula decimal em TRNAMT
  });

  it('interpreta extrato de cartão (CCSTMTRS) e XML 2.x', () => {
    const xml = `<?xml version="1.0"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL</CURDEF>
      <CCACCTFROM><ACCTID>9999</ACCTID></CCACCTFROM><BANKTRANLIST>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260310</DTPOSTED><TRNAMT>-89.90</TRNAMT><FITID>X1</FITID><MEMO>LOJA</MEMO></STMTTRN>
      </BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
    const [st] = parseOfxText(xml);
    expect(st?.kind).toBe('card');
    expect(flattenOfx([st!]).rows[0]).toMatchObject({
      amountCents: 8990,
      direction: 'out',
      externalId: 'X1',
    });
  });

  it('rejeita arquivo que não é OFX, moeda estrangeira e extrato vazio', () => {
    expect(() => parseOfxText('isto nao e ofx')).toThrow(ImportFileError);
    expect(() => parseOfxText('<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>')).toThrow(/Nenhum extrato/);
    const usd = SGML.replace('<CURDEF>BRL', '<CURDEF>USD');
    expect(() => flattenOfx(parseOfxText(usd))).toThrow(/moeda/);
  });

  it('transações idênticas no mesmo OFX (FITID diferentes) são mantidas e identificadas', () => {
    const { rows } = flattenOfx(parseOfxText(SGML));
    expect(rows[2]!.fingerprint).not.toBe(rows[3]!.fingerprint); // sufixo #1/#2
    expect(repeatedInFile(rows)).toEqual(new Set([3, 4]));
  });
});

describe('assinaturas e duplicatas', () => {
  const mk = (n: number, desc: string, amount = 1000) => ({
    rowNumber: n,
    raw: {},
    occurredOn: '2026-03-07',
    description: desc,
    amountCents: amount,
    direction: 'out' as const,
    externalId: null,
    rejectReason: null,
    fingerprint: null,
  });

  it('é estável entre importações do mesmo conteúdo (reimportar casa linha a linha)', () => {
    const a = assignFingerprints([mk(1, 'Café'), mk(2, 'Café'), mk(3, 'Pão')]);
    const b = assignFingerprints([mk(1, 'Café'), mk(2, 'Café'), mk(3, 'Pão')]);
    expect(a.map((r) => r.fingerprint)).toEqual(b.map((r) => r.fingerprint));
  });

  it('compras legítimas iguais recebem assinaturas distintas (nada é descartado)', () => {
    const [x, y] = assignFingerprints([mk(1, 'Café'), mk(2, 'Café')]);
    expect(x!.fingerprint).not.toBe(y!.fingerprint);
    expect(x!.fingerprint).toMatch(/#1$/);
    expect(y!.fingerprint).toMatch(/#2$/);
  });

  it('ignora diferenças de caixa, acento e pontuação na descrição', () => {
    const [x] = assignFingerprints([mk(1, 'CAFÉ  da Esquina!')]);
    const [y] = assignFingerprints([mk(1, 'cafe da esquina')]);
    expect(x!.fingerprint).toBe(y!.fingerprint);
    expect(normalizeDescription('Pão de Açúcar - 123')).toBe('pao de acucar 123');
  });

  it('valor, data ou sentido diferentes geram assinaturas diferentes', () => {
    const base = assignFingerprints([mk(1, 'Café')])[0]!.fingerprint;
    expect(assignFingerprints([mk(1, 'Café', 1001)])[0]!.fingerprint).not.toBe(base);
    expect(assignFingerprints([{ ...mk(1, 'Café'), direction: 'in' as const }])[0]!.fingerprint).not.toBe(
      base,
    );
    expect(assignFingerprints([{ ...mk(1, 'Café'), occurredOn: '2026-03-08' }])[0]!.fingerprint).not.toBe(
      base,
    );
  });
});

describe('validação do arquivo (tamanho, formato e conteúdo real)', () => {
  it('aceita CSV e OFX válidos; detecta o formato pelo conteúdo', () => {
    expect(validateAndDecode('extrato.csv', enc('Data;Valor\n01/03/2026;1,00')).format).toBe('csv');
    expect(validateAndDecode('x.ofx', enc('OFXHEADER:100\n<OFX></OFX>')).format).toBe('ofx');
  });

  it('rejeita vazio, grande demais, extensão errada, binário e .ofx falso', () => {
    expect(() => validateAndDecode('a.csv', new Uint8Array())).toThrow(/vazio/);
    expect(() => validateAndDecode('a.csv', new Uint8Array(MAX_IMPORT_BYTES + 1).fill(65))).toThrow(/limite/);
    expect(() => validateAndDecode('a.pdf', enc('x;y'))).toThrow(/Formato não suportado/);
    expect(() => validateAndDecode('a.csv', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 1, 2]))).toThrow(
      /binário/,
    );
    expect(() => validateAndDecode('a.ofx', enc('Data;Valor\n1;2'))).toThrow(/OFX válido/);
    expect(() => validateAndDecode('a.csv', enc('<script>alert(1)</script>;x'))).toThrow(/não permitido/);
  });

  it('decodifica Windows-1252 quando UTF-8 estrito falha; mesmo texto gera o mesmo hash', () => {
    const bytes = new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f, 0x3b, 0x31]); // "João;1" em latin1
    expect(decodeBytes(bytes).text).toBe('João;1');
    const a = validateAndDecode('a.csv', enc('Data;Valor\n01/03/2026;1,00'));
    const b = validateAndDecode('b.csv', enc('Data;Valor\n01/03/2026;1,00'));
    expect(a.hash).toBe(b.hash);
    expect(validateAndDecode('c.csv', enc('Data;Valor\n01/03/2026;2,00')).hash).not.toBe(a.hash);
  });
});
