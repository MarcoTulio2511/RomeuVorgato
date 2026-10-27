import { useMemo, useState, type FormEvent } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, diffDays, formatDateBR, formatDayMonthBR, isValidISODate } from '../../domain/dates';
import { formatBRL, type Cents } from '../../domain/money/money';
import { cashTimeline, freeCash } from '../../domain/projections/freeCash';
import { scopeData } from '../../domain/snapshot';
import type { Frequency, PlannedTransaction, RecurringRule, Scope, WeekendRule } from '../../domain/types';
import {
  ChartCard,
  axisProps,
  gridProps,
  money,
  moneyCompact,
  tooltipStyle,
} from '../../components/charts/ChartCard';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import {
  Amount,
  Button,
  Card,
  CheckRow,
  EmptyState,
  Eyebrow,
  FormError,
  FormGrid,
  Hero,
  ListItem,
  MoneyField,
  Muted,
  PageHeader,
  PlainList,
  Pill,
  Row,
  SelectField,
  Spacer,
  Stack,
  TextField,
} from '../../components/ui/primitives';
import { useSubmit } from '../../hooks/useSubmit';
import {
  deletePlanned,
  deleteRecurring,
  insertPlanned,
  insertRecurring,
  rebuildRecurring,
  settlePlanned,
  skipPlanned,
  updateRecurring,
} from '../../services/supabase/api';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { FREQ_LABEL, WEEKEND_LABEL } from '../shared/labels';
import { AccountSelect, CardSelect, CategorySelect } from '../shared/pickers';

const untilFor = (today: string) => addDays(today, 150);

function RuleForm({ rule, onClose }: { rule?: RecurringRule; onClose: () => void }) {
  const { household, me, data, today, refresh } = useReadyHousehold();
  const [type, setType] = useState<'income' | 'expense'>(rule?.type ?? 'expense');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [amount, setAmount] = useState<Cents | null>(rule?.amountCents ?? null);
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? 'monthly');
  const [interval, setIntervalCount] = useState(String(rule?.intervalCount ?? 1));
  const [start, setStart] = useState(rule?.startDate ?? today);
  const [end, setEnd] = useState(rule?.endDate ?? '');
  const [via, setVia] = useState<'account' | 'card'>(rule?.cardId ? 'card' : 'account');
  const [accountId, setAccountId] = useState(
    rule?.accountId ?? data.accounts.find((a) => a.ownerId === me.userId && a.isActive)?.id ?? '',
  );
  const [cardId, setCardId] = useState(rule?.cardId ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? '');
  const [scope, setScope] = useState<Scope>(rule?.scope ?? 'shared');
  const [certain, setCertain] = useState(rule?.isCertain ?? true);
  const [primary, setPrimary] = useState(rule?.isPrimaryIncome ?? false);
  const [subscription, setSubscription] = useState(rule?.isSubscription ?? false);
  const [weekend, setWeekend] = useState<WeekendRule>(rule?.weekendRule ?? 'none');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useSubmit(
    async () => {
      const payload = {
        description: description.trim(),
        type,
        amount_cents: amount!,
        frequency,
        interval_count: Number(interval),
        start_date: start,
        end_date: end || null,
        account_id: type === 'income' || via === 'account' ? accountId : null,
        card_id: type === 'expense' && via === 'card' ? cardId : null,
        category_id: categoryId || null,
        scope,
        is_certain: type === 'income' ? certain : true,
        is_primary_income: type === 'income' && primary,
        is_subscription: type === 'expense' && subscription,
        weekend_rule: weekend,
      };
      let id = rule?.id;
      if (rule) await updateRecurring(rule.id, payload);
      else id = await insertRecurring(household.id, me.userId, payload);
      await rebuildRecurring(household.id, id!, untilFor(today)); // regenera só os previstos futuros ainda não efetivados
    },
    {
      successMessage: rule ? 'Regra atualizada.' : 'Regra criada.',
      onSuccess: async () => {
        await refresh();
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!description.trim()) err.description = 'Descreva a conta ou receita.';
    if (!amount || amount <= 0) err.amount = 'Informe um valor maior que zero.';
    if (!isValidISODate(start)) err.start = 'Data inválida.';
    if (end && (!isValidISODate(end) || end < start)) err.end = 'A data final deve ser depois do início.';
    const n = Number(interval);
    if (!Number.isInteger(n) || n < 1 || n > 24) err.interval = 'Use de 1 a 24.';
    if ((type === 'income' || via === 'account') && !accountId) err.account = 'Escolha a conta.';
    if (type === 'expense' && via === 'card' && !cardId) err.card = 'Escolha o cartão.';
    setErrors(err);
    if (!Object.keys(err).length)
      void save.submit(
        JSON.stringify([
          type,
          description,
          amount,
          frequency,
          interval,
          start,
          end,
          via,
          accountId,
          cardId,
          categoryId,
          scope,
          certain,
          primary,
          subscription,
          weekend,
        ]),
      );
  };

  return (
    <Modal title={rule ? 'Editar recorrência' : 'Nova conta recorrente'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
          <FormGrid>
            <SelectField
              label="Tipo"
              value={type}
              onChange={(e) => setType(e.target.value as 'income' | 'expense')}
            >
              <option value="expense">Despesa / conta a pagar</option>
              <option value="income">Receita (ex.: salário)</option>
            </SelectField>
            <TextField
              label="Descrição"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              error={errors.description}
              maxLength={180}
            />
            <MoneyField label="Valor esperado" value={amount} onChange={setAmount} error={errors.amount} />
            <SelectField
              label="Frequência"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {Object.entries(FREQ_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
            <TextField
              label="A cada quantos períodos"
              type="number"
              min={1}
              max={24}
              value={interval}
              onChange={(e) => setIntervalCount(e.target.value)}
              error={errors.interval}
            />
            <TextField
              label="Primeira data"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              error={errors.start}
              hint="O dia desta data é a âncora: dia 31 vira 28/29/30 nos meses curtos."
            />
            <TextField
              label="Termina em (opcional)"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              error={errors.end}
            />
            <SelectField
              label="Fim de semana"
              value={weekend}
              onChange={(e) => setWeekend(e.target.value as WeekendRule)}
              hint="Feriados não são considerados."
            >
              {Object.entries(WEEKEND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
            {type === 'expense' && (
              <SelectField
                label="Cobrado em"
                value={via}
                onChange={(e) => setVia(e.target.value as 'account' | 'card')}
              >
                <option value="account">Conta</option>
                <option value="card">Cartão</option>
              </SelectField>
            )}
            {type === 'income' || via === 'account' ? (
              <AccountSelect
                label={type === 'income' ? 'Cai na conta' : 'Debita da conta'}
                mineOnly
                value={accountId}
                onChange={setAccountId}
                error={errors.account}
              />
            ) : (
              <CardSelect label="Cartão" mineOnly value={cardId} onChange={setCardId} error={errors.card} />
            )}
            <CategorySelect kind={type} value={categoryId} onChange={setCategoryId} />
            <SelectField label="Quem" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="shared">Compartilhada</option>
              <option value="individual">Individual</option>
            </SelectField>
            {type === 'income' && (
              <CheckRow>
                <input type="checkbox" checked={certain} onChange={(e) => setCertain(e.target.checked)} />
                Valor confirmado (desmarque se for estimado)
              </CheckRow>
            )}
            {type === 'income' && (
              <CheckRow>
                <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
                Renda principal (define o “até o próximo salário”)
              </CheckRow>
            )}
            {type === 'expense' && (
              <CheckRow>
                <input
                  type="checkbox"
                  checked={subscription}
                  onChange={(e) => setSubscription(e.target.checked)}
                />
                É uma assinatura
              </CheckRow>
            )}
          </FormGrid>
          {save.error && <FormError role="alert">{save.error}</FormError>}
          <Row $justify="flex-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.submitting}>
              Salvar
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}

function OneOffForm({ onClose }: { onClose: () => void }) {
  const { household, me, data, today, refresh } = useReadyHousehold();
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<Cents | null>(null);
  const [due, setDue] = useState(today);
  const [accountId, setAccountId] = useState(
    data.accounts.find((a) => a.ownerId === me.userId && a.isActive)?.id ?? '',
  );
  const [certain, setCertain] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSubmit(
    async () =>
      insertPlanned(household.id, me.userId, {
        due_date: due,
        description: description.trim(),
        type,
        amount_cents: amount!,
        account_id: accountId,
        card_id: null,
        category_id: null,
        scope: 'shared',
        is_certain: type === 'income' ? certain : true,
      }),
    {
      successMessage: 'Compromisso previsto.',
      onSuccess: async () => {
        await refresh();
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!description.trim()) err.description = 'Descreva o compromisso.';
    if (!amount || amount <= 0) err.amount = 'Informe um valor maior que zero.';
    if (!isValidISODate(due)) err.due = 'Data inválida.';
    if (!accountId) err.account = 'Escolha a conta.';
    setErrors(err);
    if (!Object.keys(err).length)
      void save.submit(JSON.stringify([type, description, amount, due, accountId, certain]));
  };
  return (
    <Modal title="Compromisso avulso" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
          <FormGrid>
            <SelectField
              label="Tipo"
              value={type}
              onChange={(e) => setType(e.target.value as 'income' | 'expense')}
            >
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </SelectField>
            <TextField
              label="Descrição"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              error={errors.description}
            />
            <MoneyField label="Valor" value={amount} onChange={setAmount} error={errors.amount} />
            <TextField
              label="Data prevista"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              error={errors.due}
            />
            <AccountSelect mineOnly value={accountId} onChange={setAccountId} error={errors.account} />
            {type === 'income' && (
              <CheckRow>
                <input type="checkbox" checked={certain} onChange={(e) => setCertain(e.target.checked)} />
                Valor confirmado
              </CheckRow>
            )}
          </FormGrid>
          {save.error && <FormError role="alert">{save.error}</FormError>}
          <Row $justify="flex-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.submitting}>
              Salvar
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}

function SettleForm({ item, onClose }: { item: PlannedTransaction; onClose: () => void }) {
  const { data, me, today, refresh } = useReadyHousehold();
  const [via, setVia] = useState<'account' | 'card'>(item.cardId ? 'card' : 'account');
  const [accountId, setAccountId] = useState(
    item.accountId && data.accounts.find((a) => a.id === item.accountId)?.ownerId === me.userId
      ? item.accountId
      : (data.accounts.find((a) => a.ownerId === me.userId && a.isActive)?.id ?? ''),
  );
  const [cardId, setCardId] = useState(item.cardId ?? '');
  const [amount, setAmount] = useState<Cents | null>(item.amountCents);
  const [date, setDate] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSubmit(
    async (_v: string, requestId: string) =>
      settlePlanned({
        id: item.id,
        requestId,
        accountId: item.type === 'income' || via === 'account' ? accountId : null,
        cardId: item.type === 'expense' && via === 'card' ? cardId : null,
        amountCents: amount,
        occurredOn: date,
      }),
    {
      successMessage: item.type === 'income' ? 'Receita registrada.' : 'Pagamento registrado.',
      onSuccess: async () => {
        await refresh();
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!amount || amount <= 0) err.amount = 'Informe um valor maior que zero.';
    if ((item.type === 'income' || via === 'account') && !accountId) err.account = 'Escolha a conta.';
    if (item.type === 'expense' && via === 'card' && !cardId) err.card = 'Escolha o cartão.';
    setErrors(err);
    if (!Object.keys(err).length) void save.submit(JSON.stringify([via, accountId, cardId, amount, date]));
  };
  return (
    <Modal title={item.type === 'income' ? 'Confirmar recebimento' : 'Confirmar pagamento'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
          <Muted $small>
            “{item.description}” prevista para {formatDateBR(item.dueDate)}. Ao confirmar, o lançamento real é
            criado e a previsão deixa de contar.
          </Muted>
          <MoneyField label="Valor efetivo" value={amount} onChange={setAmount} error={errors.amount} />
          <TextField label="Data" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {item.type === 'expense' && (
            <SelectField
              label="Pago com"
              value={via}
              onChange={(e) => setVia(e.target.value as 'account' | 'card')}
            >
              <option value="account">Conta</option>
              <option value="card">Cartão</option>
            </SelectField>
          )}
          {item.type === 'income' || via === 'account' ? (
            <AccountSelect mineOnly value={accountId} onChange={setAccountId} error={errors.account} />
          ) : (
            <CardSelect mineOnly value={cardId} onChange={setCardId} error={errors.card} />
          )}
          {save.error && <FormError role="alert">{save.error}</FormError>}
          <Row $justify="flex-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.submitting}>
              Confirmar
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}

export default function PlanningPage() {
  const { data, view, snapshot, today, refresh, nameOf } = useReadyHousehold();
  const [customHorizon, setCustomHorizon] = useState('');
  const [rule, setRule] = useState<{ rule?: RecurringRule } | null>(null);
  const [oneOff, setOneOff] = useState(false);
  const [settle, setSettle] = useState<PlannedTransaction | null>(null);
  const [delRule, setDelRule] = useState<RecurringRule | null>(null);

  const scoped = useMemo(() => scopeData(data, view), [data, view]);
  const horizon =
    customHorizon && isValidISODate(customHorizon) && customHorizon >= today
      ? customHorizon
      : snapshot.horizon.date;
  const input = {
    today,
    horizon,
    accounts: scoped.accounts,
    cards: scoped.cards,
    invoices: scoped.invoices,
    txs: scoped.transactions,
    planned: scoped.planned,
  };
  const fc = useMemo(() => freeCash(input), [scoped, today, horizon]); // eslint-disable-line react-hooks/exhaustive-deps
  const points = useMemo(() => cashTimeline(input), [scoped, today, horizon]); // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = scoped.planned
    .filter((p) => p.status === 'planned')
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const skip = useSubmit(async (id: string) => skipPlanned(id), {
    successMessage: 'Previsão ignorada.',
    onSuccess: refresh,
  });
  const delPlanned = useSubmit(async (id: string) => deletePlanned(id), {
    successMessage: 'Previsão removida.',
    onSuccess: refresh,
  });
  const toggleRule = useSubmit(
    async (r: RecurringRule) => {
      await updateRecurring(r.id, { is_active: !r.isActive });
    },
    { successMessage: 'Regra atualizada.', onSuccess: refresh },
  );
  const removeRule = useSubmit(
    async () => {
      await deleteRecurring(delRule!.id);
    },
    {
      successMessage: 'Regra excluída.',
      onSuccess: async () => {
        setDelRule(null);
        await refresh();
      },
    },
  );

  const chart = points.map((p) => ({
    date: formatDayMonthBR(p.date),
    Garantido: p.guaranteedCents,
    'Com estimadas': p.estimatedCents,
    eventos: p.events.join(', '),
  }));
  const days = diffDays(horizon, today);

  return (
    <Stack $gap={20}>
      <PageHeader
        title="Planejamento"
        subtitle="Contas futuras, rendas esperadas e quanto sobra até o próximo salário."
        actions={
          <>
            <Button variant="ghost" onClick={() => setOneOff(true)}>
              Compromisso avulso
            </Button>
            <Button icon="plus" onClick={() => setRule({})}>
              Conta recorrente
            </Button>
          </>
        }
      />

      <Card $tone="accent">
        <Stack $gap={14}>
          <Eyebrow>
            Dinheiro livre até {formatDateBR(horizon)} ({days} {days === 1 ? 'dia' : 'dias'})
          </Eyebrow>
          <Hero>
            <Amount cents={fc.guaranteedFreeCents} tone={fc.guaranteedFreeCents < 0 ? 'negative' : 'plain'} />
          </Hero>
          <Row $wrap $gap={8}>
            <Pill $tone={fc.isComplete ? 'positive' : 'warning'}>
              {fc.isComplete ? 'Previsão com dados completos' : 'Estimativa incompleta'}
            </Pill>
            {fc.estimatedIncomeCents > 0 && (
              <Pill $tone="info">Com receitas estimadas: {formatBRL(fc.estimatedFreeCents)}</Pill>
            )}
          </Row>
          <PlainList>
            <ListItem>
              <span>Saldo das contas ({data.accounts.length ? 'visão atual' : 'nenhuma conta'})</span>
              <Spacer />
              <Amount cents={fc.bankBalanceCents} />
            </ListItem>
            <ListItem>
              <span>+ Receitas confirmadas até lá</span>
              <Spacer />
              <Amount cents={fc.confirmedIncomeCents} />
            </ListItem>
            <ListItem>
              <span>− Faturas e despesas previstas</span>
              <Spacer />
              <Amount cents={-fc.commitmentsCents} />
            </ListItem>
          </PlainList>
          <Row $wrap>
            <TextField
              label="Mudar a data final"
              type="date"
              min={today}
              value={customHorizon}
              onChange={(e) => setCustomHorizon(e.target.value)}
              hint={`Padrão: ${snapshot.horizon.reason === 'next_income' ? 'próxima renda prevista' : 'fim do mês (nenhuma renda prevista)'}`}
            />
            {customHorizon && (
              <Button small variant="ghost" onClick={() => setCustomHorizon('')}>
                Usar padrão
              </Button>
            )}
          </Row>
          <details>
            <summary style={{ cursor: 'pointer' }}>Premissas e limitações</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#a1a496', fontSize: 14 }}>
              {fc.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        </Stack>
      </Card>

      {fc.commitments.length > 0 && (
        <Card>
          <Stack $gap={4}>
            <Eyebrow>Compromissos considerados</Eyebrow>
            <PlainList>
              {fc.commitments.map((c) => (
                <ListItem key={`${c.kind}${c.refId}`}>
                  <Stack $gap={0}>
                    <strong>{c.label}</strong>
                    <Muted $small>
                      {c.kind === 'invoice'
                        ? 'Fatura em aberto'
                        : c.kind === 'planned_card_expense'
                          ? 'Vai para fatura do cartão'
                          : 'Despesa prevista'}{' '}
                      · {formatDateBR(c.dueDate)}
                    </Muted>
                  </Stack>
                  <Spacer />
                  <Amount cents={c.amountCents} />
                </ListItem>
              ))}
            </PlainList>
          </Stack>
        </Card>
      )}

      <ChartCard
        title="Previsão de caixa"
        criterion="Saldo projetado nos dias com evento. “Garantido” só conta receitas confirmadas; a linha pontilhada inclui as estimadas."
        empty={points.length < 2}
        emptyText="Cadastre contas recorrentes e rendas esperadas para ver a previsão."
        summary={`Previsão de caixa de ${formatDayMonthBR(today)} a ${formatDayMonthBR(horizon)}`}
        table={{
          headers: ['Data', 'Garantido', 'Com estimadas', 'Eventos'],
          rows: chart.map((c) => [c.date, formatBRL(c.Garantido), formatBRL(c['Com estimadas']), c.eventos]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyCompact} width={64} />
            <Tooltip {...tooltipStyle} formatter={money} />
            <Area
              type="stepAfter"
              dataKey="Garantido"
              stroke="#c8f542"
              fill="rgba(200,245,66,0.15)"
              strokeWidth={2}
            />
            <Area
              type="stepAfter"
              dataKey="Com estimadas"
              stroke="#8fb8ff"
              fill="transparent"
              strokeDasharray="5 4"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card>
        <Stack $gap={6}>
          <Eyebrow>Próximas ocorrências</Eyebrow>
          {upcoming.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="Nada previsto"
              text="Cadastre salário, aluguel, assinaturas… e eu monto o calendário."
              action={
                <Button onClick={() => setRule({})} icon="plus">
                  Conta recorrente
                </Button>
              }
            />
          ) : (
            <PlainList>
              {upcoming.slice(0, 40).map((p) => {
                const late = p.dueDate < today;
                const mine = p.ownerId === data.currentUserId;
                return (
                  <ListItem key={p.id} style={{ flexWrap: 'wrap' }}>
                    <Stack $gap={0} style={{ flex: 1, minWidth: 160 }}>
                      <strong>{p.description}</strong>
                      <Muted $small>
                        {formatDateBR(p.dueDate)} · {nameOf(p.ownerId)}{' '}
                        {p.type === 'income' && !p.isCertain && '· estimada'}
                      </Muted>
                    </Stack>
                    {late && <Pill $tone="danger">Atrasada</Pill>}
                    {p.isSubscription && <Pill $tone="info">Assinatura</Pill>}
                    <Amount
                      cents={p.type === 'income' ? p.amountCents : -p.amountCents}
                      tone={p.type === 'income' ? 'positive' : 'plain'}
                      signed
                    />
                    {mine && (
                      <Row $gap={6}>
                        <Button small variant="soft" onClick={() => setSettle(p)}>
                          {p.type === 'income' ? 'Recebi' : 'Paguei'}
                        </Button>
                        <Button small variant="ghost" onClick={() => void skip.submit(p.id)}>
                          Ignorar
                        </Button>
                        {!p.recurringId && (
                          <Button small variant="danger" onClick={() => void delPlanned.submit(p.id)}>
                            Remover
                          </Button>
                        )}
                      </Row>
                    )}
                  </ListItem>
                );
              })}
            </PlainList>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack $gap={6}>
          <Eyebrow>Regras recorrentes</Eyebrow>
          {scoped.recurring.length === 0 ? (
            <Muted>Nenhuma regra cadastrada.</Muted>
          ) : (
            <PlainList>
              {scoped.recurring.map((r) => (
                <ListItem key={r.id} style={{ flexWrap: 'wrap' }}>
                  <Stack $gap={0} style={{ flex: 1, minWidth: 180 }}>
                    <strong>{r.description}</strong>
                    <Muted $small>
                      {FREQ_LABEL[r.frequency]}
                      {r.intervalCount > 1 ? ` (a cada ${r.intervalCount})` : ''} desde{' '}
                      {formatDateBR(r.startDate)}
                      {r.endDate ? ` até ${formatDateBR(r.endDate)}` : ''} · {nameOf(r.ownerId)}
                    </Muted>
                  </Stack>
                  {!r.isActive && <Pill $tone="warning">Pausada</Pill>}
                  <Amount cents={r.amountCents} tone={r.type === 'income' ? 'positive' : 'plain'} />
                  {r.ownerId === data.currentUserId && (
                    <Row $gap={6}>
                      <Button small variant="ghost" onClick={() => setRule({ rule: r })}>
                        Editar
                      </Button>
                      <Button small variant="ghost" onClick={() => void toggleRule.submit(r)}>
                        {r.isActive ? 'Pausar' : 'Retomar'}
                      </Button>
                      <Button small variant="danger" onClick={() => setDelRule(r)}>
                        Excluir
                      </Button>
                    </Row>
                  )}
                </ListItem>
              ))}
            </PlainList>
          )}
          <Muted $small>
            As regras geram apenas previsões. Elas só viram lançamentos quando você confirma
            (“Paguei”/“Recebi”) — nada é criado sozinho.
          </Muted>
        </Stack>
      </Card>

      {rule && <RuleForm rule={rule.rule} onClose={() => setRule(null)} />}
      {oneOff && <OneOffForm onClose={() => setOneOff(false)} />}
      {settle && <SettleForm item={settle} onClose={() => setSettle(null)} />}
      {delRule && (
        <ConfirmDialog
          title="Excluir regra?"
          message={`“${delRule.description}” e suas previsões futuras serão removidas. Lançamentos já confirmados permanecem.`}
          confirmLabel="Excluir"
          busy={removeRule.submitting}
          error={removeRule.error}
          onCancel={() => {
            setDelRule(null);
            removeRule.clearError();
          }}
          onConfirm={() => void removeRule.submit(delRule.id)}
        />
      )}
    </Stack>
  );
}
