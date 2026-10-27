import { useCallback, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { budgetUsage, categoryFamily } from '../../domain/budgets/budgets';
import { spendingEvents, type InstallmentPolicy } from '../../domain/budgets/spending';
import {
  addMonthKey,
  endOfMonth,
  formatDayMonthBR,
  formatMonthLabel,
  monthKey,
  monthRange,
} from '../../domain/dates';
import { formatBRL } from '../../domain/money/money';
import { cashFlowTotals } from '../../domain/transactions/balances';
import { scopeData } from '../../domain/snapshot';
import {
  ChartCard,
  axisProps,
  gridProps,
  money,
  moneyCompact,
  tooltipStyle,
} from '../../components/charts/ChartCard';
import {
  Amount,
  Card,
  Eyebrow,
  Grid,
  Hero,
  Muted,
  PageHeader,
  SelectField,
  Segmented,
  Stack,
} from '../../components/ui/primitives';
import { theme } from '../../styles/theme';
import { useReadyHousehold } from '../household/HouseholdProvider';

const COLORS = theme.chart;

export default function ReportsPage() {
  const { data, view, snapshot, today } = useReadyHousehold();
  const [months, setMonths] = useState<'3' | '6' | '12'>('6');
  const [policy, setPolicy] = useState<InstallmentPolicy>(data.prefs.installmentPolicy);
  const [budgetId, setBudgetId] = useState('');

  const scoped = useMemo(() => scopeData(data, view), [data, view]);
  const current = monthKey(today);
  const keys = useMemo(
    () => monthRange(addMonthKey(current, -(Number(months) - 1)), current),
    [months, current],
  );
  const label = (k: string) => formatMonthLabel(k, true);

  const events = useMemo(
    () =>
      spendingEvents(scoped.transactions, {
        invoices: scoped.invoices,
        plans: scoped.plans,
        basis: 'competence',
        installmentPolicy: policy,
      }),
    [scoped, policy],
  );
  const inPeriod = useCallback(
    (date: string) => date.slice(0, 7) >= keys[0]! && date.slice(0, 7) <= current,
    [keys, current],
  );

  const monthly = useMemo(
    () =>
      keys.map((k) => {
        const income = scoped.transactions
          .filter((t) => t.status === 'posted' && t.type === 'income' && monthKey(t.occurredOn) === k)
          .reduce((a, t) => a + t.amountCents, 0);
        const ev = events.filter((e) => monthKey(e.date) === k);
        const expense = ev.reduce((a, e) => a + e.amountCents, 0);
        const shared = ev.filter((e) => e.scope === 'shared').reduce((a, e) => a + e.amountCents, 0);
        const cf = cashFlowTotals(scoped.transactions, `${k}-01`, endOfMonth(`${k}-01`));
        return {
          key: k,
          mes: label(k),
          Receitas: income,
          Despesas: expense,
          Compartilhadas: shared,
          Individuais: expense - shared,
          Entradas: cf.inflowCents,
          Saídas: cf.outflowCents,
          'Saldo do mês': cf.netCents,
        };
      }),
    [keys, scoped, events],
  );

  const totals = monthly.reduce((a, m) => ({ inc: a.inc + m.Receitas, exp: a.exp + m.Despesas }), {
    inc: 0,
    exp: 0,
  });

  const byCategory = useMemo(() => {
    const roots = data.categories.filter((c) => c.kind === 'expense' && c.parentId === null);
    const rows = roots.map((c) => {
      const ids = categoryFamily(data.categories, c.id);
      const total = events
        .filter((e) => inPeriod(e.date) && e.categoryId && ids.has(e.categoryId))
        .reduce((a, e) => a + e.amountCents, 0);
      return { name: c.name, Valor: total };
    });
    const uncategorized = events
      .filter((e) => inPeriod(e.date) && !e.categoryId)
      .reduce((a, e) => a + e.amountCents, 0);
    if (uncategorized !== 0) rows.push({ name: 'Sem categoria', Valor: uncategorized });
    return rows
      .filter((r) => r.Valor > 0)
      .sort((a, b) => b.Valor - a.Valor)
      .slice(0, 10);
  }, [data.categories, events, inPeriod]);

  const compare = useMemo(() => {
    const prev = addMonthKey(current, -1);
    const roots = data.categories.filter((c) => c.kind === 'expense' && c.parentId === null);
    return roots
      .map((c) => {
        const ids = categoryFamily(data.categories, c.id);
        const sum = (k: string) =>
          events
            .filter((e) => monthKey(e.date) === k && e.categoryId && ids.has(e.categoryId))
            .reduce((a, e) => a + e.amountCents, 0);
        return { name: c.name, [label(prev)]: sum(prev), [label(current)]: sum(current) };
      })
      .filter((r) => Object.values(r).some((v) => typeof v === 'number' && v > 0))
      .slice(0, 8);
  }, [data.categories, events, current]);

  const budgets = data.budgets.filter((b) => b.isActive);
  const selected = budgets.find((b) => b.id === budgetId) ?? budgets[0];
  const budgetEvolution = useMemo(() => {
    if (!selected) return [];
    return keys.map((k) => {
      const u = budgetUsage(selected, events, data.categories, k, today);
      return { mes: label(k), Gasto: u.spentCents, Limite: selected.limitCents };
    });
  }, [selected, keys, events, data.categories, today]);

  const obligations = snapshot.freeCash.commitments.map((c) => ({
    data: formatDayMonthBR(c.dueDate),
    nome: c.label,
    Valor: c.amountCents,
  }));
  const hasData = monthly.some((m) => m.Receitas > 0 || m.Despesas > 0 || m.Entradas > 0 || m.Saídas > 0);

  return (
    <Stack $gap={20}>
      <PageHeader title="Relatórios" subtitle="Os mesmos critérios em cartões, tabelas e gráficos." />
      <Card $pad={18}>
        <Stack $gap={12}>
          <Grid $min={220}>
            <Stack $gap={6}>
              <Eyebrow>Período</Eyebrow>
              <Segmented
                label="Período"
                value={months}
                onChange={setMonths}
                options={[
                  { value: '3', label: '3 meses' },
                  { value: '6', label: '6 meses' },
                  { value: '12', label: '12 meses' },
                ]}
              />
            </Stack>
            <SelectField
              label="Compras parceladas contam…"
              value={policy}
              onChange={(e) => setPolicy(e.target.value as InstallmentPolicy)}
            >
              <option value="parcel">Parcela a parcela, no mês de cada parcela</option>
              <option value="purchase">O total na data da compra</option>
            </SelectField>
          </Grid>
          <Muted $small>
            Consumo = despesas e compras no cartão por data de competência (estornos descontados;
            transferências e pagamento de fatura ficam de fora).{' '}
            {policy === 'parcel'
              ? 'Cada parcela entra no seu mês.'
              : 'O total da compra entra uma vez, no mês da compra — as parcelas não são somadas de novo.'}
          </Muted>
        </Stack>
      </Card>

      <Grid $min={220}>
        <Card $pad={18}>
          <Eyebrow>Receitas no período</Eyebrow>
          <Hero $size={30}>
            <Amount cents={totals.inc} tone="positive" />
          </Hero>
        </Card>
        <Card $pad={18}>
          <Eyebrow>Despesas no período</Eyebrow>
          <Hero $size={30}>
            <Amount cents={totals.exp} />
          </Hero>
        </Card>
        <Card $pad={18}>
          <Eyebrow>Resultado</Eyebrow>
          <Hero $size={30}>
            <Amount
              cents={totals.inc - totals.exp}
              tone={totals.inc - totals.exp < 0 ? 'negative' : 'plain'}
            />
          </Hero>
        </Card>
      </Grid>

      <ChartCard
        title="Receitas × despesas por mês"
        criterion="Receitas efetivadas e consumo (competência)."
        empty={!hasData}
        summary={`Receitas e despesas dos últimos ${months} meses`}
        table={{
          headers: ['Mês', 'Receitas', 'Despesas'],
          rows: monthly.map((m) => [m.mes, formatBRL(m.Receitas), formatBRL(m.Despesas)]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthly} margin={{ left: 0, right: 8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="mes" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyCompact} width={64} />
            <Tooltip {...tooltipStyle} formatter={money} />
            <Legend />
            <Bar dataKey="Receitas" fill="#c8f542" radius={[6, 6, 0, 0]} />
            <Bar dataKey="Despesas" fill="#ff9f7a" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Gastos por categoria"
        criterion="Soma do período, com subcategorias dentro da categoria-pai."
        empty={byCategory.length === 0}
        summary="Gastos por categoria no período"
        table={{ headers: ['Categoria', 'Valor'], rows: byCategory.map((c) => [c.name, formatBRL(c.Valor)]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byCategory} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid {...gridProps} horizontal={false} vertical />
            <XAxis type="number" {...axisProps} tickFormatter={moneyCompact} />
            <YAxis type="category" dataKey="name" {...axisProps} width={96} />
            <Tooltip {...tooltipStyle} formatter={money} />
            <Bar dataKey="Valor" radius={[0, 6, 6, 0]} fill={COLORS[0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Fluxo de caixa (base caixa)"
        criterion="Dinheiro que entrou e saiu das contas. Compra no cartão só sai quando a fatura é paga; transferências internas não contam."
        empty={!monthly.some((m) => m.Entradas > 0 || m.Saídas > 0)}
        summary="Entradas, saídas e saldo mensal de caixa"
        table={{
          headers: ['Mês', 'Entradas', 'Saídas', 'Saldo'],
          rows: monthly.map((m) => [
            m.mes,
            formatBRL(m.Entradas),
            formatBRL(m.Saídas),
            formatBRL(m['Saldo do mês']),
          ]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={monthly} margin={{ left: 0, right: 8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="mes" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyCompact} width={64} />
            <Tooltip {...tooltipStyle} formatter={money} />
            <Legend />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
            <Line dataKey="Entradas" stroke="#c8f542" strokeWidth={2} dot={false} />
            <Line dataKey="Saídas" stroke="#ff9f7a" strokeWidth={2} dot={false} />
            <Line dataKey="Saldo do mês" stroke="#8fb8ff" strokeWidth={2} strokeDasharray="5 4" dot />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Mês atual × mês anterior"
        criterion="Por categoria (competência)."
        empty={compare.length === 0}
        summary="Comparação de gastos por categoria entre o mês atual e o anterior"
        table={{
          headers: ['Categoria', label(addMonthKey(current, -1)), label(current)],
          rows: compare.map((c) => [
            String(c.name),
            formatBRL(Number(c[label(addMonthKey(current, -1))] ?? 0)),
            formatBRL(Number(c[label(current)] ?? 0)),
          ]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={compare} margin={{ left: 0, right: 8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} interval={0} tick={{ fill: '#a1a496', fontSize: 11 }} />
            <YAxis {...axisProps} tickFormatter={moneyCompact} width={64} />
            <Tooltip {...tooltipStyle} formatter={money} />
            <Legend />
            <Bar dataKey={label(addMonthKey(current, -1))} fill="#6d7065" radius={[6, 6, 0, 0]} />
            <Bar dataKey={label(current)} fill="#c8f542" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Individuais × compartilhadas"
        criterion="Cada despesa compartilhada é contada uma única vez."
        empty={!monthly.some((m) => m.Despesas > 0)}
        summary="Despesas individuais e compartilhadas por mês"
        table={{
          headers: ['Mês', 'Individuais', 'Compartilhadas'],
          rows: monthly.map((m) => [m.mes, formatBRL(m.Individuais), formatBRL(m.Compartilhadas)]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthly} margin={{ left: 0, right: 8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="mes" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyCompact} width={64} />
            <Tooltip {...tooltipStyle} formatter={money} />
            <Legend />
            <Bar dataKey="Individuais" stackId="a" fill="#8fb8ff" />
            <Bar dataKey="Compartilhadas" stackId="a" fill="#c8f542" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <Stack $gap={10}>
        {budgets.length > 1 && (
          <SelectField
            label="Orçamento"
            value={selected?.id ?? ''}
            onChange={(e) => setBudgetId(e.target.value)}
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {data.categories.find((c) => c.id === b.categoryId)?.name ?? 'Categoria'}
                {b.ownerId ? ' (pessoal)' : ''}
              </option>
            ))}
          </SelectField>
        )}
        <ChartCard
          title="Evolução do orçamento"
          criterion="Gasto líquido de cada mês contra o limite atual do orçamento."
          empty={!selected}
          emptyText="Crie um orçamento para acompanhar a evolução."
          summary="Gasto mensal contra o limite do orçamento"
          table={{
            headers: ['Mês', 'Gasto', 'Limite'],
            rows: budgetEvolution.map((b) => [b.mes, formatBRL(b.Gasto), formatBRL(b.Limite)]),
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={budgetEvolution} margin={{ left: 0, right: 8 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="mes" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={moneyCompact} width={64} />
              <Tooltip {...tooltipStyle} formatter={money} />
              <Legend />
              <Bar dataKey="Gasto" fill="#c8f542" radius={[6, 6, 0, 0]} />
              {selected && (
                <ReferenceLine
                  y={selected.limitCents}
                  stroke="#ffc857"
                  strokeDasharray="4 4"
                  label={{ value: 'Limite', fill: '#ffc857', fontSize: 12 }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Stack>

      <ChartCard
        title="Próximas obrigações (previsão)"
        criterion={`Faturas em aberto e despesas previstas até ${formatDayMonthBR(snapshot.freeCash.horizon)}. São valores previstos, não realizados.`}
        empty={obligations.length === 0}
        emptyText="Nenhuma fatura ou despesa prevista até o horizonte."
        summary="Próximas obrigações financeiras previstas"
        table={{
          headers: ['Data', 'Compromisso', 'Valor'],
          rows: obligations.map((o) => [o.data, o.nome, formatBRL(o.Valor)]),
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={obligations} margin={{ left: 0, right: 8 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="data" {...axisProps} />
            <YAxis {...axisProps} tickFormatter={moneyCompact} width={64} />
            <Tooltip
              {...tooltipStyle}
              formatter={money}
              labelFormatter={(_l, p) => String(p?.[0]?.payload?.nome ?? '')}
            />
            <Bar
              dataKey="Valor"
              fill="#ffc857"
              fillOpacity={0.7}
              stroke="#ffc857"
              strokeDasharray="4 3"
              radius={[6, 6, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </Stack>
  );
}
