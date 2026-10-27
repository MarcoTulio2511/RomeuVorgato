import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { addMonthsClamped, endOfMonth, formatDateBR, startOfMonth } from '../../domain/dates';
import type { Transaction } from '../../domain/types';
import { Icon } from '../../components/ui/Icon';
import { ConfirmDialog } from '../../components/ui/Modal';
import {
  Amount,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Muted,
  PageHeader,
  Pill,
  Row,
  SelectField,
  Skeleton,
  Spacer,
  Stack,
  TextField,
  Grid,
} from '../../components/ui/primitives';
import { useSubmit } from '../../hooks/useSubmit';
import {
  cancelInstallmentPlan,
  cancelTransaction,
  listTransactions,
  reverseTransaction,
  type TypeGroup,
} from '../../services/supabase/api';
import { friendlyError } from '../../services/supabase/errors';
import { media } from '../../styles/theme';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { TX_LABEL, displaySign } from '../shared/labels';
import { AccountSelect, CardSelect, CategorySelect } from '../shared/pickers';
import { TransactionFormModal } from './TransactionForm';

const PAGE_SIZE = 25;
const Row2 = styled.li`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 12px;
  padding: 14px 0;
  align-items: center;
  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.border};
  }
  ${media.md} {
    grid-template-columns: 96px minmax(0, 1fr) 190px auto auto;
    gap: 16px;
  }
`;
const Desc = styled.div`
  min-width: 0;
  strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
const Actions = styled.div`
  display: flex;
  gap: 6px;
  grid-column: 1 / -1;
  ${media.md} {
    grid-column: auto;
  }
`;
const Mini = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.muted};
  &:hover {
    color: ${({ theme }) => theme.colors.text};
    background: ${({ theme }) => theme.colors.surface2};
  }
`;

type Action = { kind: 'delete' | 'reverse' | 'cancelPlan'; tx: Transaction };

export default function TransactionsPage() {
  const { household, data, today, refresh, nameOf, members } = useReadyHousehold();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(endOfMonth(today));
  const [ownerId, setOwnerId] = useState('');
  const [accountId, setAccountId] = useState(params.get('conta') ?? '');
  const [cardId, setCardId] = useState(params.get('cartao') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [group, setGroup] = useState<TypeGroup | ''>('');
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing?: Transaction } | null>(null);
  const [action, setAction] = useState<Action | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [debounced, from, to, ownerId, accountId, cardId, categoryId, group]);

  const filtersKey = `${debounced}|${from}|${to}|${ownerId}|${accountId}|${cardId}|${categoryId}|${group}|${page}|${version}`;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    listTransactions(household.id, {
      from: from || undefined,
      to: to || undefined,
      ownerId: ownerId || undefined,
      accountId: accountId || undefined,
      cardId: cardId || undefined,
      categoryId: categoryId || undefined,
      group: group || undefined,
      search: debounced,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((r) => {
        if (alive) {
          setRows(r.rows);
          setCount(r.count);
          setError(null);
        }
      })
      .catch((e) => alive && setError(friendlyError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, household.id]);

  const reload = useCallback(async () => {
    await refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  const catName = useMemo(() => new Map(data.categories.map((c) => [c.id, c.name])), [data.categories]);
  const accName = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data.accounts]);
  const cardName = useMemo(() => new Map(data.cards.map((c) => [c.id, c.name])), [data.cards]);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const run = useSubmit(
    async (_k: string, requestId: string) => {
      if (!action) return;
      if (action.kind === 'delete') await cancelTransaction(action.tx.id, requestId);
      else if (action.kind === 'reverse') await reverseTransaction(action.tx.id, requestId, today);
      else await cancelInstallmentPlan(action.tx.installmentPlanId!, requestId);
    },
    {
      successMessage: 'Feito.',
      onSuccess: async () => {
        setAction(null);
        await reload();
      },
    },
  );

  const clear = () => {
    setSearch('');
    setOwnerId('');
    setAccountId('');
    setCardId('');
    setCategoryId('');
    setGroup('');
    setFrom(startOfMonth(today));
    setTo(endOfMonth(today));
    setParams({});
  };
  const shiftMonth = (n: number) => {
    const base = addMonthsClamped(startOfMonth(from || today), n);
    setFrom(startOfMonth(base));
    setTo(endOfMonth(base));
  };

  return (
    <Stack $gap={20}>
      <PageHeader
        title="Movimentações"
        subtitle="Receitas, despesas e transferências de vocês."
        actions={
          <Button icon="plus" onClick={() => setForm({})}>
            Nova
          </Button>
        }
      />

      <Card $pad={18}>
        <Stack $gap={14}>
          <TextField
            label="Buscar"
            type="search"
            placeholder="Descrição…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Grid $min={170}>
            <TextField label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <SelectField label="Titular" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Todos</option>
              {members
                .filter((m) => m.isActive)
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
            </SelectField>
            <SelectField
              label="Tipo"
              value={group}
              onChange={(e) => setGroup(e.target.value as TypeGroup | '')}
            >
              <option value="">Todos</option>
              <option value="income">Receitas</option>
              <option value="expense">Despesas (conta e cartão)</option>
              <option value="transfer">Transferências</option>
              <option value="payment">Pagamentos de fatura</option>
              <option value="refund">Estornos</option>
              <option value="adjustment">Ajustes</option>
            </SelectField>
            <AccountSelect label="Conta" allowEmpty value={accountId} onChange={setAccountId} />
            <CardSelect label="Cartão" allowEmpty value={cardId} onChange={setCardId} />
            <CategorySelect label="Categoria" kind="any" value={categoryId} onChange={setCategoryId} />
          </Grid>
          <Row $wrap $gap={8}>
            <Button small variant="ghost" onClick={() => shiftMonth(-1)}>
              ← Mês anterior
            </Button>
            <Button small variant="ghost" onClick={() => shiftMonth(1)}>
              Próximo mês →
            </Button>
            <Spacer />
            <Button small variant="ghost" onClick={clear}>
              Limpar filtros
            </Button>
          </Row>
        </Stack>
      </Card>

      {error ? (
        <ErrorState message={error} onRetry={() => setVersion((v) => v + 1)} />
      ) : loading && rows.length === 0 ? (
        <Stack $gap={10} aria-busy="true">
          <Skeleton $h={56} />
          <Skeleton $h={56} />
          <Skeleton $h={56} />
        </Stack>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="list"
          title="Nenhuma movimentação encontrada"
          text="Ajuste os filtros ou lance a primeira movimentação do período."
          action={
            <Button onClick={() => setForm({})} icon="plus">
              Nova movimentação
            </Button>
          }
        />
      ) : (
        <Card $pad={8} style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: '0 14px' }}>
            {rows.map((t) => {
              const sign = displaySign(t);
              const where = t.accountId ? accName.get(t.accountId) : t.cardId ? cardName.get(t.cardId) : '';
              const editable = t.status !== 'cancelled';
              return (
                <Row2 key={t.id}>
                  <Muted $small>{formatDateBR(t.occurredOn)}</Muted>
                  <Desc>
                    <strong title={t.description}>{t.description}</strong>
                    <Muted $small>
                      {TX_LABEL[t.type]}
                      {t.categoryId ? ` · ${catName.get(t.categoryId) ?? ''}` : ''} · {where} ·{' '}
                      {nameOf(t.ownerId)}
                    </Muted>
                  </Desc>
                  <Row $gap={6} $wrap>
                    {t.scope === 'shared' && <Pill $tone="accent">Compartilhada</Pill>}
                    {t.status === 'pending' && <Pill $tone="warning">Pendente</Pill>}
                    {t.source === 'import' && <Pill>Importada</Pill>}
                    {t.installmentNumber && <Pill $tone="info">Parcela {t.installmentNumber}</Pill>}
                  </Row>
                  <div style={{ textAlign: 'right', fontWeight: 650 }}>
                    <Amount cents={t.amountCents} signed={sign > 0} tone={sign > 0 ? 'positive' : 'plain'} />
                    {sign < 0 ? <span className="sr-only"> (saída)</span> : null}
                  </div>
                  {editable && (
                    <Actions>
                      <Mini
                        type="button"
                        onClick={() => setForm({ editing: t })}
                        aria-label={`Editar ${t.description}`}
                      >
                        <Icon name="edit" size={16} />
                        Editar
                      </Mini>
                      {(t.type === 'expense' || t.type === 'card_purchase' || t.type === 'card_fee') &&
                        t.status === 'posted' && (
                          <Mini
                            type="button"
                            onClick={() => setAction({ kind: 'reverse', tx: t })}
                            aria-label={`Estornar ${t.description}`}
                          >
                            <Icon name="arrows" size={16} />
                            Estornar
                          </Mini>
                        )}
                      <Mini
                        type="button"
                        onClick={() =>
                          setAction({ kind: t.installmentPlanId ? 'cancelPlan' : 'delete', tx: t })
                        }
                        aria-label={`Excluir ${t.description}`}
                      >
                        <Icon name="trash" size={16} />
                        Excluir
                      </Mini>
                    </Actions>
                  )}
                </Row2>
              );
            })}
          </ul>
        </Card>
      )}

      {count > PAGE_SIZE && (
        <Row $justify="center" $wrap>
          <Button small variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <Muted $small aria-live="polite">
            Página {page + 1} de {pages} · {count} lançamentos
          </Muted>
          <Button small variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Próxima
          </Button>
        </Row>
      )}

      {form && (
        <TransactionFormModal
          editing={form.editing}
          onClose={() => setForm(null)}
          onDone={() => setVersion((v) => v + 1)}
        />
      )}
      {action && (
        <ConfirmDialog
          title={
            action.kind === 'reverse'
              ? 'Estornar lançamento?'
              : action.kind === 'cancelPlan'
                ? 'Cancelar o parcelamento inteiro?'
                : 'Excluir lançamento?'
          }
          message={
            action.kind === 'reverse'
              ? `Será criado um lançamento de estorno de ${action.tx.description}. O original é mantido no histórico.`
              : action.kind === 'cancelPlan'
                ? 'Todas as parcelas deste parcelamento serão canceladas. O histórico fica registrado.'
                : action.tx.type.startsWith('transfer')
                  ? 'As duas pontas da transferência serão removidas dos saldos. O histórico de auditoria é preservado.'
                  : `“${action.tx.description}” deixará de contar nos saldos e relatórios. O histórico de auditoria é preservado.`
          }
          confirmLabel={action.kind === 'reverse' ? 'Estornar' : 'Excluir'}
          danger={action.kind !== 'reverse'}
          busy={run.submitting}
          error={run.error}
          onCancel={() => {
            setAction(null);
            run.clearError();
          }}
          onConfirm={() => void run.submit(`${action.kind}:${action.tx.id}`)}
        />
      )}
    </Stack>
  );
}
