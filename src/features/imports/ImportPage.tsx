import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateBR } from '../../domain/dates';
import type { AmountFormat, DateFormat, NormalizedRow } from '../../domain/imports/normalize';
import {
  Amount,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  FormError,
  Grid,
  ListItem,
  Muted,
  PageHeader,
  PlainList,
  Pill,
  Row,
  SelectField,
  Spacer,
  Stack,
} from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { useToast } from '../../components/feedback/Toast';
import { useSubmit } from '../../hooks/useSubmit';
import {
  cancelImport,
  confirmImport,
  createImportBatch,
  listImportBatches,
  loadImportRows,
  revertImport,
  type ImportBatchRow,
  type ImportRowView,
} from '../../services/supabase/api';
import { friendlyError } from '../../services/supabase/errors';
import {
  DEFAULT_CSV_OPTIONS,
  guessMapping,
  normalizeCsv,
  parseCsvText,
  type CsvMapping,
  type CsvOptions,
  type CsvTable,
} from '../../services/imports/csv';
import {
  MAX_IMPORT_BYTES,
  loadImportFile,
  type LoadedImportFile,
  type TextEncodingName,
} from '../../services/imports/file';
import { ImportFileError, flattenOfx, parseOfxText } from '../../services/imports/ofx';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { CategorySelect } from '../shared/pickers';

type Stage = 'setup' | 'map' | 'ofx' | 'review' | 'done';
const STATUS_LABEL = {
  valid: 'Válida',
  invalid: 'Inválida',
  duplicate: 'Duplicada',
  review: 'Revisar',
} as const;
const STATUS_TONE = {
  valid: 'positive',
  invalid: 'danger',
  duplicate: 'warning',
  review: 'warning',
} as const;

export default function ImportPage() {
  const { household, data, me, refresh, nameOf } = useReadyHousehold();
  const toast = useToast();
  const myAccounts = data.accounts.filter((a) => a.ownerId === me.userId && a.isActive);
  const myCards = data.cards.filter((c) => c.ownerId === me.userId && c.isActive);

  const [stage, setStage] = useState<Stage>('setup');
  const [targetKind, setTargetKind] = useState<'account' | 'card'>(
    myAccounts.length || !myCards.length ? 'account' : 'card',
  );
  const [targetId, setTargetId] = useState('');
  const [encoding, setEncoding] = useState<TextEncodingName>('auto');
  const [file, setFile] = useState<LoadedImportFile | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [table, setTable] = useState<CsvTable | null>(null);
  const [delimiter, setDelimiter] = useState('auto');
  const [hasHeader, setHasHeader] = useState<'auto' | 'yes' | 'no'>('auto');
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [opts, setOpts] = useState<CsvOptions>(DEFAULT_CSV_OPTIONS);
  const [ofxRows, setOfxRows] = useState<NormalizedRow[] | null>(null);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [repeated, setRepeated] = useState(false);
  const [rows, setRows] = useState<ImportRowView[]>([]);
  const [edits, setEdits] = useState<
    Record<string, { include: boolean; categoryId: string; description?: string }>
  >({});
  const [filter, setFilter] = useState<'all' | ImportRowView['status']>('all');
  const [result, setResult] = useState<{ imported: number } | null>(null);
  const [history, setHistory] = useState<ImportBatchRow[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [revert, setRevert] = useState<ImportBatchRow | null>(null);

  const target =
    targetKind === 'account'
      ? data.accounts.find((a) => a.id === targetId)
      : data.cards.find((c) => c.id === targetId);

  const loadHistory = useCallback(() => {
    listImportBatches(household.id)
      .then((h) => {
        setHistory(h);
        setHistoryError(null);
      })
      .catch((e) => setHistoryError(friendlyError(e)));
  }, [household.id]);
  useEffect(loadHistory, [loadHistory]);

  /* ---- 1) arquivo ---- */
  const pick = async (f: File | null, enc: TextEncodingName = encoding) => {
    setFileError(null);
    setFile(null);
    setTable(null);
    setOfxRows(null);
    setMapping(null);
    if (!f) return;
    setRawFile(f);
    try {
      const loaded = await loadImportFile(f, enc);
      setFile(loaded);
      if (loaded.format === 'ofx') {
        const { rows: r } = flattenOfx(parseOfxText(loaded.text));
        setOfxRows(r);
      } else {
        const t = parseCsvText(loaded.text);
        setTable(t);
        setDelimiter('auto');
        setHasHeader('auto');
        const g = guessMapping(t.headers);
        setMapping({
          date: g.date ?? 0,
          description: g.description ?? Math.min(1, t.headers.length - 1),
          amount: g.amount ?? null,
          debit: g.debit ?? null,
          credit: g.credit ?? null,
          type: g.type ?? null,
          externalId: g.externalId ?? null,
        });
      }
    } catch (e) {
      setFileError(e instanceof ImportFileError ? e.message : friendlyError(e));
    }
  };

  const reparse = (d: string, h: 'auto' | 'yes' | 'no') => {
    if (!file) return;
    const t = parseCsvText(file.text, {
      delimiter: d === 'auto' ? undefined : d,
      hasHeader: h === 'auto' ? undefined : h === 'yes',
    });
    setTable(t);
    setDelimiter(d);
    setHasHeader(h);
    const g = guessMapping(t.headers);
    setMapping({
      date: g.date ?? 0,
      description: g.description ?? Math.min(1, t.headers.length - 1),
      amount: g.amount ?? null,
      debit: g.debit ?? null,
      credit: g.credit ?? null,
      type: g.type ?? null,
      externalId: g.externalId ?? null,
    });
  };

  const normalized = useMemo(() => {
    if (file?.format === 'ofx')
      return ofxRows ? { rows: ofxRows, dateFormat: null as DateFormat | null } : null;
    if (table && mapping) return normalizeCsv(table, mapping, opts);
    return null;
  }, [file, ofxRows, table, mapping, opts]);

  const counts = useMemo(() => {
    const r = normalized?.rows ?? [];
    return {
      total: r.length,
      valid: r.filter((x) => !x.rejectReason).length,
      invalid: r.filter((x) => x.rejectReason).length,
    };
  }, [normalized]);

  /* ---- 2) prévia no servidor ---- */
  const stageBatch = useSubmit(
    async () => {
      const sum = await createImportBatch({
        householdId: household.id,
        accountId: targetKind === 'account' ? targetId : null,
        cardId: targetKind === 'card' ? targetId : null,
        fileName: file!.name,
        format: file!.format,
        fileHash: file!.hash,
        mapping:
          file!.format === 'csv'
            ? { ...mapping, ...opts, delimiter: table?.delimiter, encoding: file!.encoding }
            : { encoding: file!.encoding },
        rows: normalized!.rows,
      });
      setBatchId(sum.batchId);
      setRepeated(sum.repeatedFile);
      const r = await loadImportRows(sum.batchId);
      setRows(r);
      setEdits(
        Object.fromEntries(r.map((x) => [x.id, { include: x.include, categoryId: x.categoryId ?? '' }])),
      );
    },
    { onSuccess: () => setStage('review') },
  );

  /* ---- 3) confirmar ---- */
  const included = rows.filter((r) => edits[r.id]?.include && r.status !== 'invalid');
  const confirm = useSubmit(
    async (_v: string, requestId: string) =>
      confirmImport(
        batchId!,
        requestId,
        rows.map((r) => ({
          row_id: r.id,
          include: !!edits[r.id]?.include && r.status !== 'invalid',
          category_id: edits[r.id]?.categoryId || null,
          ...(edits[r.id]?.description ? { description: edits[r.id]!.description } : {}),
        })),
      ),
    {
      successMessage: 'Importação concluída.',
      onSuccess: async (r) => {
        setResult(r);
        setStage('done');
        await refresh();
        loadHistory();
      },
    },
  );

  const reset = () => {
    setStage('setup');
    setFile(null);
    setRawFile(null);
    setTable(null);
    setOfxRows(null);
    setMapping(null);
    setBatchId(null);
    setRows([]);
    setEdits({});
    setResult(null);
    setFileError(null);
    setFilter('all');
  };
  const cancelBatch = async () => {
    try {
      if (batchId) await cancelImport(batchId);
    } catch (e) {
      toast.error(friendlyError(e));
    }
    reset();
    loadHistory();
  };
  const undo = useSubmit(async () => revertImport(revert!.id), {
    successMessage: 'Importação desfeita.',
    onSuccess: async () => {
      setRevert(null);
      await refresh();
      loadHistory();
    },
  });

  const visibleRows = rows.filter((r) => filter === 'all' || r.status === filter);
  const rowCounts = {
    valid: rows.filter((r) => r.status === 'valid').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    dup: rows.filter((r) => r.status === 'duplicate' || r.status === 'review').length,
  };
  const noTargets = myAccounts.length === 0 && myCards.length === 0;
  const headerOptions =
    table?.headers.map((h, i) => (
      <option key={i} value={i}>
        {h}
      </option>
    )) ?? [];
  const colSelect = (label: string, key: keyof CsvMapping, optional: boolean) => (
    <SelectField
      label={label}
      value={mapping?.[key] ?? ''}
      onChange={(e) =>
        setMapping((m) => (m ? { ...m, [key]: e.target.value === '' ? null : Number(e.target.value) } : m))
      }
    >
      {optional && <option value="">— não usar —</option>}
      {headerOptions}
    </SelectField>
  );

  return (
    <Stack $gap={20}>
      <PageHeader
        title="Importar extrato"
        subtitle="CSV ou OFX do seu banco ou cartão, com prévia e revisão antes de gravar."
      />
      <Muted $small>
        O arquivo é lido no seu navegador — ele não é enviado nem guardado. Só as linhas normalizadas vão para
        o banco. Cada banco usa um layout: mapeie as colunas e confira a prévia.
      </Muted>

      {stage === 'setup' && (
        <Card>
          <Stack>
            {noTargets ? (
              <EmptyState
                icon="wallet"
                title="Cadastre uma conta ou cartão primeiro"
                text="A importação precisa de um destino seu."
                action={<Link to="/contas">Ir para Contas</Link>}
              />
            ) : (
              <>
                <Grid $min={220}>
                  <SelectField
                    label="Importar para"
                    value={targetKind}
                    onChange={(e) => {
                      setTargetKind(e.target.value as 'account' | 'card');
                      setTargetId('');
                    }}
                  >
                    {myAccounts.length > 0 && <option value="account">Uma conta</option>}
                    {myCards.length > 0 && <option value="card">Um cartão (fatura)</option>}
                  </SelectField>
                  <SelectField
                    label={targetKind === 'account' ? 'Conta' : 'Cartão'}
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  >
                    <option value="" disabled>
                      Escolha…
                    </option>
                    {(targetKind === 'account' ? myAccounts : myCards).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Codificação do texto"
                    value={encoding}
                    onChange={(e) => {
                      const v = e.target.value as TextEncodingName;
                      setEncoding(v);
                      void pick(rawFile, v);
                    }}
                  >
                    <option value="auto">Automática</option>
                    <option value="utf-8">UTF-8</option>
                    <option value="windows-1252">Windows-1252 (bancos antigos)</option>
                    <option value="iso-8859-1">ISO-8859-1</option>
                  </SelectField>
                </Grid>
                <div>
                  <label
                    htmlFor="import-file"
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#a1a496',
                      marginBottom: 6,
                    }}
                  >
                    Arquivo (.csv ou .ofx, até {MAX_IMPORT_BYTES / 1024 / 1024} MB)
                  </label>
                  <input
                    id="import-file"
                    type="file"
                    accept=".csv,.ofx,.qfx,.txt,text/csv"
                    onChange={(e) => void pick(e.target.files?.[0] ?? null)}
                    style={{ width: '100%', minHeight: 48 }}
                  />
                </div>
                {fileError && <FormError role="alert">{fileError}</FormError>}
                {file && (
                  <Muted $small>
                    {file.name} · {file.format.toUpperCase()} · {(file.size / 1024).toFixed(1)} KB ·{' '}
                    {file.encoding}
                    {counts.total > 0 && ` · ${counts.total} linhas`}
                  </Muted>
                )}
                <Row $justify="flex-end">
                  <Button
                    disabled={!targetId || !file || !!fileError || !normalized || counts.total === 0}
                    onClick={() => setStage(file?.format === 'csv' ? 'map' : 'ofx')}
                  >
                    Continuar
                  </Button>
                </Row>
              </>
            )}
          </Stack>
        </Card>
      )}

      {stage === 'map' && table && mapping && normalized && (
        <Card>
          <Stack>
            <Eyebrow>Interpretar o CSV</Eyebrow>
            <Grid $min={200}>
              <SelectField
                label="Delimitador"
                value={delimiter}
                onChange={(e) => reparse(e.target.value, hasHeader)}
                hint={`Detectado: "${table.delimiter === '\t' ? 'tab' : table.delimiter}"`}
              >
                <option value="auto">Automático</option>
                <option value=";">Ponto e vírgula (;)</option>
                <option value=",">Vírgula (,)</option>
                <option value={'\t'}>Tab</option>
                <option value="|">Barra (|)</option>
              </SelectField>
              <SelectField
                label="Primeira linha"
                value={hasHeader}
                onChange={(e) => reparse(delimiter, e.target.value as 'auto' | 'yes' | 'no')}
              >
                <option value="auto">Detectar cabeçalho</option>
                <option value="yes">É cabeçalho</option>
                <option value="no">Já é dado</option>
              </SelectField>
              <SelectField
                label="Formato da data"
                value={opts.dateFormat}
                onChange={(e) =>
                  setOpts((o) => ({ ...o, dateFormat: e.target.value as CsvOptions['dateFormat'] }))
                }
                hint={
                  opts.dateFormat === 'auto'
                    ? `Detectado: ${'dateFormat' in normalized ? normalized.dateFormat : null}`
                    : undefined
                }
              >
                <option value="auto">Automático</option>
                <option value="dd/MM/yyyy">dd/mm/aaaa</option>
                <option value="MM/dd/yyyy">mm/dd/aaaa</option>
                <option value="yyyy-MM-dd">aaaa-mm-dd</option>
              </SelectField>
              <SelectField
                label="Formato do valor"
                value={opts.amountFormat}
                onChange={(e) => setOpts((o) => ({ ...o, amountFormat: e.target.value as AmountFormat }))}
              >
                <option value="auto">Automático (vírgula decimal)</option>
                <option value="br">1.234,56 (brasileiro)</option>
                <option value="us">1,234.56 (americano)</option>
              </SelectField>
            </Grid>
            <Grid $min={200}>
              {colSelect('Coluna da data', 'date', false)}
              {colSelect('Coluna da descrição', 'description', false)}
              {colSelect('Coluna do valor (com sinal)', 'amount', true)}
              {colSelect('Coluna de débito', 'debit', true)}
              {colSelect('Coluna de crédito', 'credit', true)}
              {colSelect('Coluna de tipo (D/C)', 'type', true)}
              {colSelect('Identificador externo', 'externalId', true)}
              <SelectField
                label="Quando não há coluna de tipo"
                value={opts.signRule}
                onChange={(e) =>
                  setOpts((o) => ({ ...o, signRule: e.target.value as CsvOptions['signRule'] }))
                }
              >
                <option value="negative_is_expense">Valor negativo = saída</option>
                <option value="positive_is_expense">Valor positivo = saída</option>
              </SelectField>
            </Grid>
            <Stack $gap={4}>
              <Muted $small>
                <strong>{counts.valid}</strong> linhas boas · <strong>{counts.invalid}</strong> com problema
                (de {counts.total}). Primeiras linhas:
              </Muted>
              <PlainList>
                {normalized.rows.slice(0, 6).map((r) => (
                  <ListItem key={r.rowNumber}>
                    <Muted $small>{r.occurredOn ? formatDateBR(r.occurredOn) : '—'}</Muted>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.description ?? Object.values(r.raw).join(' | ')}
                    </span>
                    {r.rejectReason ? (
                      <Pill $tone="danger">{r.rejectReason}</Pill>
                    ) : (
                      <Amount
                        cents={(r.direction === 'out' ? -1 : 1) * (r.amountCents ?? 0)}
                        tone={r.direction === 'in' ? 'positive' : 'plain'}
                      />
                    )}
                  </ListItem>
                ))}
              </PlainList>
            </Stack>
            {table.warnings.length > 0 && (
              <Muted $small>Avisos do leitor: {table.warnings.slice(0, 3).join('; ')}</Muted>
            )}
            {stageBatch.error && <FormError role="alert">{stageBatch.error}</FormError>}
            <Row $justify="flex-end" $wrap>
              <Button variant="ghost" onClick={reset}>
                Voltar
              </Button>
              <Button
                loading={stageBatch.submitting}
                disabled={counts.total === 0 || counts.total > 5000}
                onClick={() => void stageBatch.submit(JSON.stringify(mapping))}
              >
                Gerar prévia
              </Button>
            </Row>
            {counts.total > 5000 && <FormError>O limite é de 5.000 linhas por importação.</FormError>}
          </Stack>
        </Card>
      )}

      {stage === 'ofx' && normalized && (
        <Card>
          <Stack>
            <Eyebrow>Arquivo OFX lido</Eyebrow>
            <Muted>
              {counts.valid} lançamentos válidos e {counts.invalid} com problema, de {counts.total}.
            </Muted>
            {stageBatch.error && <FormError role="alert">{stageBatch.error}</FormError>}
            <Row $justify="flex-end">
              <Button variant="ghost" onClick={reset}>
                Voltar
              </Button>
              <Button loading={stageBatch.submitting} onClick={() => void stageBatch.submit('ofx')}>
                Gerar prévia
              </Button>
            </Row>
          </Stack>
        </Card>
      )}

      {stage === 'review' && (
        <Stack $gap={14}>
          {repeated && (
            <Card $tone="warning" $pad={16}>
              <strong>Este arquivo já foi importado antes para este destino.</strong>
              <Muted $small>
                Marquei as linhas repetidas abaixo. Nada será importado de novo sem a sua decisão.
              </Muted>
            </Card>
          )}
          <Card>
            <Stack $gap={10}>
              <Row $wrap $gap={8}>
                <Eyebrow>Prévia de {target?.name}</Eyebrow>
                <Spacer />
                {(
                  [
                    ['all', `Todas (${rows.length})`],
                    ['valid', `Válidas (${rowCounts.valid})`],
                    ['duplicate', 'Duplicadas'],
                    ['review', 'Revisar'],
                    ['invalid', `Inválidas (${rowCounts.invalid})`],
                  ] as const
                ).map(([k, l]) => (
                  <Button
                    key={k}
                    small
                    variant={filter === k ? 'soft' : 'ghost'}
                    onClick={() => setFilter(k)}
                  >
                    {l}
                  </Button>
                ))}
              </Row>
              <Muted $small>
                Linhas “Duplicada” (mesmo identificador) e “Revisar” (assinatura ou lançamento parecido) vêm
                desmarcadas. Compras legítimas iguais não são descartadas — você decide.
              </Muted>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {visibleRows.map((r) => {
                  const e = edits[r.id] ?? { include: false, categoryId: '' };
                  const dim = r.status === 'invalid';
                  return (
                    <li
                      key={r.id}
                      style={{
                        display: 'grid',
                        gap: 8,
                        gridTemplateColumns: 'auto 1fr auto',
                        alignItems: 'center',
                        padding: '12px 0',
                        borderTop: '1px solid rgba(255,255,255,0.08)',
                        opacity: dim ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Importar linha ${r.rowNumber}`}
                        style={{ width: 22, height: 22, accentColor: '#c8f542' }}
                        checked={e.include && !dim}
                        disabled={dim}
                        onChange={(ev) =>
                          setEdits((s) => ({ ...s, [r.id]: { ...e, include: ev.target.checked } }))
                        }
                      />
                      <Stack $gap={4}>
                        <Row $wrap $gap={8}>
                          <strong>{r.description ?? '(sem descrição)'}</strong>
                          <Pill $tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                        </Row>
                        <Muted $small>
                          Linha {r.rowNumber} · {r.occurredOn ? formatDateBR(r.occurredOn) : 'sem data'}
                          {r.rejectReason ? ` · ${r.rejectReason}` : ''}
                        </Muted>
                        {!dim && (
                          <div style={{ maxWidth: 360 }}>
                            <CategorySelect
                              label="Categoria"
                              kind={r.direction === 'in' ? 'income' : 'expense'}
                              value={e.categoryId}
                              onChange={(v) => setEdits((s) => ({ ...s, [r.id]: { ...e, categoryId: v } }))}
                            />
                          </div>
                        )}
                      </Stack>
                      <div style={{ textAlign: 'right', fontWeight: 650 }}>
                        {r.amountCents !== null && (
                          <Amount
                            cents={(r.direction === 'out' ? -1 : 1) * r.amountCents}
                            tone={r.direction === 'in' ? 'positive' : 'plain'}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Stack>
          </Card>
          <Card $pad={18}>
            <Stack $gap={10}>
              <Muted>
                Vão ser importadas <strong>{included.length}</strong> de {rows.length} linhas
                {included.length > 0 && (
                  <>
                    {' '}
                    · total de saídas{' '}
                    <Amount
                      cents={included
                        .filter((r) => r.direction === 'out')
                        .reduce((a, r) => a + (r.amountCents ?? 0), 0)}
                    />{' '}
                    · entradas{' '}
                    <Amount
                      cents={included
                        .filter((r) => r.direction === 'in')
                        .reduce((a, r) => a + (r.amountCents ?? 0), 0)}
                    />
                  </>
                )}
                . Tudo é gravado de uma vez: se algo falhar, nada é importado.
              </Muted>
              {confirm.error && <FormError role="alert">{confirm.error}</FormError>}
              <Row $justify="flex-end" $wrap>
                <Button variant="ghost" onClick={() => void cancelBatch()} disabled={confirm.submitting}>
                  Cancelar importação
                </Button>
                <Button
                  loading={confirm.submitting}
                  disabled={included.length === 0}
                  onClick={() => void confirm.submit(JSON.stringify([rows.map((r) => r.id), edits]))}
                >
                  Importar {included.length} lançamentos
                </Button>
              </Row>
            </Stack>
          </Card>
        </Stack>
      )}

      {stage === 'done' && result && (
        <Card $tone="accent">
          <Stack>
            <h2>Importação concluída</h2>
            <p>
              {result.imported} lançamentos foram criados em {target?.name}. As linhas não marcadas ficaram de
              fora e continuam registradas no histórico.
            </p>
            <Row $wrap>
              <Button onClick={reset}>Importar outro arquivo</Button>
              <Link
                to={
                  targetKind === 'account'
                    ? `/movimentacoes?conta=${targetId}`
                    : `/movimentacoes?cartao=${targetId}`
                }
              >
                Ver movimentações
              </Link>
            </Row>
          </Stack>
        </Card>
      )}

      <Card>
        <Stack $gap={6}>
          <Eyebrow>Histórico de importações</Eyebrow>
          {historyError ? (
            <FormError role="alert">{historyError}</FormError>
          ) : history.length === 0 ? (
            <Muted>Nenhuma importação ainda.</Muted>
          ) : (
            <PlainList>
              {history.map((h) => (
                <ListItem key={h.id} style={{ flexWrap: 'wrap' }}>
                  <Stack $gap={0} style={{ flex: 1, minWidth: 180 }}>
                    <strong>{h.fileName}</strong>
                    <Muted $small>
                      {formatDateBR(h.createdAt.slice(0, 10))} · {h.format.toUpperCase()} ·{' '}
                      {nameOf(h.createdBy)} · {h.importedRows} importadas · {h.duplicateRows}{' '}
                      duplicadas/revisar · {h.invalidRows} inválidas
                    </Muted>
                  </Stack>
                  <Pill
                    $tone={
                      h.status === 'confirmed' ? 'positive' : h.status === 'reverted' ? 'warning' : 'default'
                    }
                  >
                    {{
                      preview: 'Em prévia',
                      confirmed: 'Concluída',
                      cancelled: 'Cancelada',
                      reverted: 'Desfeita',
                    }[h.status] ?? h.status}
                  </Pill>
                  {h.status === 'confirmed' && h.createdBy === me.userId && (
                    <Button small variant="ghost" onClick={() => setRevert(h)}>
                      Desfazer
                    </Button>
                  )}
                </ListItem>
              ))}
            </PlainList>
          )}
        </Stack>
      </Card>

      {revert && (
        <ConfirmDialog
          title="Desfazer importação?"
          message={`Os ${revert.importedRows} lançamentos de “${revert.fileName}” serão cancelados e deixarão de contar nos saldos. O histórico fica registrado.`}
          confirmLabel="Desfazer"
          busy={undo.submitting}
          error={undo.error}
          onCancel={() => {
            setRevert(null);
            undo.clearError();
          }}
          onConfirm={() => void undo.submit('')}
        />
      )}
    </Stack>
  );
}
