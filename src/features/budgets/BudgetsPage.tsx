import { useState, type FormEvent } from 'react';
import { MIN_DAYS_FOR_PROJECTION } from '../../domain/budgets/budgets';
import { formatDateBR } from '../../domain/dates';
import { ratioPercent, type Cents } from '../../domain/money/money';
import type { BudgetView } from '../../domain/pierre/types';
import type { BudgetBasis } from '../../domain/types';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import {
  Amount,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  FormError,
  FormGrid,
  Grid,
  ListItem,
  MoneyField,
  Muted,
  PageHeader,
  PlainList,
  Pill,
  ProgressBar,
  Row,
  SelectField,
  Spacer,
  Stack,
  TextField,
} from '../../components/ui/primitives';
import { useSubmit } from '../../hooks/useSubmit';
import { deleteBudget, insertBudget, updateBudget } from '../../services/supabase/api';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { CategorySelect } from '../shared/pickers';

function BudgetForm({ view, onClose }: { view?: BudgetView; onClose: () => void }) {
  const { household, me, today, data, refresh } = useReadyHousehold();
  const b = view?.budget;
  const [categoryId, setCategoryId] = useState(b?.categoryId ?? '');
  const [personal, setPersonal] = useState(b ? b.ownerId !== null : false);
  const [limit, setLimit] = useState<Cents | null>(b?.limitCents ?? null);
  const [basis, setBasis] = useState<BudgetBasis>(b?.basis ?? 'competence');
  const [alertPct, setAlertPct] = useState(String(b?.alertPct ?? data.prefs.defaultAlertPct));
  const [perOrder, setPerOrder] = useState<Cents | null>(b?.perOrderLimitCents ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useSubmit(
    async () => {
      const common = {
        limit_cents: limit!,
        basis,
        alert_pct: Number(alertPct),
        per_order_limit_cents: perOrder,
      };
      if (b) await updateBudget(b.id, common);
      else
        await insertBudget(household.id, {
          ...common,
          category_id: categoryId,
          owner_id: personal ? me.userId : null,
          starts_on: `${today.slice(0, 7)}-01`,
        });
    },
    {
      successMessage: b ? 'Orçamento atualizado.' : 'Orçamento criado.',
      onSuccess: async () => {
        await refresh();
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!b && !categoryId) err.category = 'Escolha a categoria.';
    if (!limit || limit <= 0) err.limit = 'Informe um limite maior que zero.';
    const p = Number(alertPct);
    if (!Number.isInteger(p) || p < 1 || p > 100) err.alert = 'Use um percentual entre 1 e 100.';
    setErrors(err);
    if (!Object.keys(err).length)
      void save.submit(JSON.stringify([categoryId, personal, limit, basis, alertPct, perOrder]));
  };
  return (
    <Modal title={b ? `Editar — ${view!.categoryName}` : 'Novo orçamento mensal'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
          <FormGrid>
            {!b && (
              <CategorySelect
                kind="expense"
                allowEmpty={false}
                value={categoryId}
                onChange={setCategoryId}
                error={errors.category}
              />
            )}
            {!b && (
              <SelectField
                label="Para quem"
                value={personal ? 'me' : 'shared'}
                onChange={(e) => setPersonal(e.target.value === 'me')}
                hint={
                  personal
                    ? 'Conta só os gastos de quem criou.'
                    : 'Conta os gastos de todos da casa nessa categoria.'
                }
              >
                <option value="shared">Compartilhado (casal)</option>
                <option value="me">Pessoal (só meu)</option>
              </SelectField>
            )}
            <MoneyField label="Limite do mês" value={limit} onChange={setLimit} error={errors.limit} />
            <TextField
              label="Alertar a partir de (%)"
              type="number"
              min={1}
              max={100}
              value={alertPct}
              onChange={(e) => setAlertPct(e.target.value)}
              error={errors.alert}
            />
            <SelectField
              label="Como contar os gastos"
              value={basis}
              onChange={(e) => setBasis(e.target.value as BudgetBasis)}
              hint={
                basis === 'competence'
                  ? 'Pela data da compra (parcelas no mês de cada parcela).'
                  : 'Pelo mês de vencimento da fatura do cartão.'
              }
            >
              <option value="competence">Data da compra / parcela</option>
              <option value="invoice">Mês de vencimento da fatura</option>
            </SelectField>
            <MoneyField
              label="Limite por pedido (opcional)"
              value={perOrder}
              onChange={setPerOrder}
              hint="Ex.: R$ 40 por pedido de delivery."
            />
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

export default function BudgetsPage() {
  const { snapshot, today, nameOf, refresh } = useReadyHousehold();
  const [form, setForm] = useState<{ view?: BudgetView } | null>(null);
  const [del, setDel] = useState<BudgetView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const remove = useSubmit(
    async () => {
      await deleteBudget(del!.budget.id);
    },
    {
      successMessage: 'Orçamento excluído.',
      onSuccess: async () => {
        setDel(null);
        await refresh();
      },
    },
  );
  const day = Number(today.slice(8, 10));

  return (
    <Stack $gap={20}>
      <PageHeader
        title="Orçamentos"
        subtitle="Quanto vocês querem gastar por categoria a cada mês."
        actions={
          <Button icon="plus" onClick={() => setForm({})}>
            Novo orçamento
          </Button>
        }
      />
      <Muted $small>
        Valor usado = gastos líquidos da categoria (e subcategorias) no mês; estornos descontam.
        Transferências entre contas próprias e pagamento de fatura não contam. Parcelas contam no mês de cada
        parcela.
      </Muted>
      {snapshot.budgetViews.length === 0 ? (
        <EmptyState
          icon="target"
          title="Nenhum orçamento este mês"
          text="Crie limites como Mercado, Lazer ou iFood. Os valores são seus — não sugerimos nenhum."
          action={
            <Button icon="plus" onClick={() => setForm({})}>
              Criar orçamento
            </Button>
          }
        />
      ) : (
        <Grid $min={340}>
          {snapshot.budgetViews.map((v) => {
            const u = v.usage;
            const tone = u.status === 'exceeded' ? 'danger' : u.status === 'warning' ? 'warning' : 'accent';
            return (
              <Card
                key={v.budget.id}
                $tone={u.status === 'exceeded' ? 'danger' : u.status === 'warning' ? 'warning' : 'default'}
              >
                <Stack $gap={12}>
                  <Row $wrap>
                    <h2 style={{ fontSize: 22 }}>{v.categoryName}</h2>
                    <Spacer />
                    <Pill $tone={v.budget.ownerId ? 'info' : 'accent'}>
                      {v.budget.ownerId ? `Pessoal · ${nameOf(v.budget.ownerId)}` : 'Casal'}
                    </Pill>
                  </Row>
                  <Stack $gap={2}>
                    <Eyebrow>
                      {u.remainingCents >= 0 ? 'Ainda dá para gastar' : 'Passou do limite em'}
                    </Eyebrow>
                    <p style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>
                      <Amount
                        cents={u.remainingCents >= 0 ? u.remainingCents : u.overCents}
                        tone={u.remainingCents < 0 ? 'negative' : 'plain'}
                      />
                    </p>
                  </Stack>
                  <ProgressBar
                    label={`Uso do orçamento de ${v.categoryName}`}
                    pct={ratioPercent(u.spentCents, u.limitCents)}
                    tone={tone}
                  />
                  <Muted $small>
                    Usado <Amount cents={u.spentCents} /> de <Amount cents={u.limitCents} /> (
                    {Math.round(ratioPercent(u.spentCents, u.limitCents))}%). Alerta em {v.budget.alertPct}%.
                  </Muted>
                  {u.projectedCents !== null && u.projectedCents !== u.spentCents ? (
                    <Muted $small>
                      Projeção até o fim do mês: <Amount cents={u.projectedCents} />{' '}
                      {u.willExceed ? '— deve passar do limite.' : '— dentro do limite.'}
                    </Muted>
                  ) : u.projectedCents === null ? (
                    <Muted $small>
                      Projeção disponível a partir do dia {MIN_DAYS_FOR_PROJECTION} (hoje é dia {day}).
                    </Muted>
                  ) : null}
                  {v.orders && v.budget.perOrderLimitCents && (
                    <Muted $small>
                      Limite por pedido <Amount cents={v.budget.perOrderLimitCents} />: cabem{' '}
                      <strong>{v.orders.guaranteedOrders}</strong> pedido(s) cheio(s)
                      {v.orders.leftoverCents > 0 && (
                        <>
                          {' '}
                          e mais um de até <Amount cents={v.orders.leftoverCents} />
                        </>
                      )}
                      .
                    </Muted>
                  )}
                  <Row $wrap $gap={8}>
                    <Button
                      small
                      variant="ghost"
                      onClick={() => setOpen(open === v.budget.id ? null : v.budget.id)}
                      aria-expanded={open === v.budget.id}
                    >
                      {open === v.budget.id ? 'Ocultar' : 'Como foi calculado'}
                    </Button>
                    <Button small variant="ghost" onClick={() => setForm({ view: v })}>
                      Editar
                    </Button>
                    <Button small variant="danger" onClick={() => setDel(v)}>
                      Excluir
                    </Button>
                  </Row>
                  {open === v.budget.id && (
                    <PlainList aria-label="Lançamentos que compõem o valor usado">
                      {u.lines.length === 0 ? (
                        <Muted $small>Nenhum gasto nesta categoria no mês.</Muted>
                      ) : (
                        u.lines.map((l) => (
                          <ListItem key={`${l.txId}${l.date}`}>
                            <Stack $gap={0}>
                              <span>{l.description}</span>
                              <Muted $small>{formatDateBR(l.date)}</Muted>
                            </Stack>
                            <Spacer />
                            <Amount cents={l.amountCents} tone={l.amountCents < 0 ? 'positive' : 'plain'} />
                          </ListItem>
                        ))
                      )}
                    </PlainList>
                  )}
                </Stack>
              </Card>
            );
          })}
        </Grid>
      )}
      {form && <BudgetForm view={form.view} onClose={() => setForm(null)} />}
      {del && (
        <ConfirmDialog
          title="Excluir orçamento?"
          message={`O orçamento de ${del.categoryName} será removido. Os lançamentos não mudam.`}
          confirmLabel="Excluir"
          busy={remove.submitting}
          error={remove.error}
          onCancel={() => {
            setDel(null);
            remove.clearError();
          }}
          onConfirm={() => void remove.submit(del.budget.id)}
        />
      )}
    </Stack>
  );
}
