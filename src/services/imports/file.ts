import { hashText } from '../../domain/imports/normalize';
import { ImportFileError } from './ofx';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMPORT_ROWS = 5000;

export type ImportFormat = 'csv' | 'ofx';
export type TextEncodingName = 'auto' | 'utf-8' | 'windows-1252' | 'iso-8859-1';

export interface LoadedImportFile {
  name: string;
  format: ImportFormat;
  text: string;
  encoding: string;
  hash: string;
  size: number;
}

/** Decodifica bytes: UTF-8 estrito primeiro; se falhar, Windows-1252 (padrão de muitos bancos brasileiros). */
export function decodeBytes(
  bytes: Uint8Array,
  encoding: TextEncodingName = 'auto',
): { text: string; encoding: string } {
  if (encoding === 'auto') {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
    } catch {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
    }
  }
  return { text: new TextDecoder(encoding).decode(bytes), encoding };
}

/** Rejeita binários: bytes NUL ou proporção alta de caracteres de controle. */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  let control = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return sample.length > 0 && control / sample.length > 0.02;
}

/** Valida tamanho, extensão e CONTEÚDO real (não confia só na extensão) e devolve o texto. */
export function validateAndDecode(
  name: string,
  bytes: Uint8Array,
  encoding: TextEncodingName = 'auto',
): LoadedImportFile {
  if (bytes.byteLength === 0) throw new ImportFileError('O arquivo está vazio.');
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportFileError(`O arquivo excede o limite de ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
  }
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (!['csv', 'ofx', 'txt', 'qfx'].includes(ext)) {
    throw new ImportFileError('Formato não suportado. Envie um arquivo .csv ou .ofx.');
  }
  if (looksBinary(bytes)) throw new ImportFileError('O conteúdo não é texto (parece um arquivo binário).');

  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 600));
  const charset = /CHARSET:\s*(\d+)/i.exec(head)?.[1];
  const hintedEncoding: TextEncodingName =
    charset === '1252' && encoding === 'auto' ? 'windows-1252' : encoding;
  const { text, encoding: used } = decodeBytes(bytes, hintedEncoding);

  const isOfx = /OFXHEADER|<OFX[\s>]/i.test(text.slice(0, 2000));
  const format: ImportFormat = isOfx ? 'ofx' : 'csv';
  if ((ext === 'ofx' || ext === 'qfx') && !isOfx)
    throw new ImportFileError('O arquivo .ofx não contém um cabeçalho OFX válido.');
  if (format === 'csv' && !/[;,\t|]/.test(text))
    throw new ImportFileError('Não encontrei colunas neste arquivo CSV.');
  if (/<script[\s>]/i.test(text)) throw new ImportFileError('O arquivo contém conteúdo não permitido.');

  return { name, format, text, encoding: used, hash: hashText(text), size: bytes.byteLength };
}

export async function loadImportFile(
  file: File,
  encoding: TextEncodingName = 'auto',
): Promise<LoadedImportFile> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportFileError(`O arquivo excede o limite de ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
  }
  return validateAndDecode(file.name, new Uint8Array(await file.arrayBuffer()), encoding);
}
