import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { formatDateBR } from '../../domain/dates';
import {
  INVOICE_STATUS_LABEL,
  cardPosition,
  invoiceCycleFor,
  invoiceStatus,
  invoiceTotals,
} from '../../domain/invoices/invoices';
import { ratioPercent, type Cents } from '../../domain/money/money';
import type { ClosingDayRule, CreditCard, Invoice } from '../../domain/types';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import {
  Amount,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  FormError,
  FormGrid,
  LinkButton,
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
import { deleteCard, insertCard, payInvoice, updateCard } from '../../services/supabase/api';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { AccountSelect } from '../shared/pickers';
import { TransactionFormModal } from '../transactions/TransactionForm';

function CardForm({ card, onClose }: { card?: CreditCard; onClose: () => void }) {
  const { household, me, today, refresh } = useReadyHousehold();
  const [name, setName] = useState(card?.name ?? '');
  const [institution, setInstitution] = useState(card?.institution ?? '');
  const [lastFour, setLastFour] = useState(card?.lastFour ?? '');
  const [limit, setLimit] = useState<Cents | null>(card?.limitCents ?? null);
  const [closing, setClosing] = useState(card ? String(card.closingDay) : '');
  const [due, setDue] = useState(card ? String(card.dueDay) : '');
  const [rule, setRule] = useState<ClosingDayRule>(card?.closingDayRule ?? 'next');
  const [payAccount, setPayAccount] = useState(card?.payAccountId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const cd = Number(closing);
  const dd = Number(due);
  const validDays =
    Number.isInteger(cd) && cd >= 1 && cd <= 31 && Number.isInteger(dd) && dd >= 1 && dd <= 31;
  const example = validDays
    ? invoiceCycleFor({ closingDay: cd, dueDay: dd, closingDayRule: rule }, today)
    : null;

  const save = useSubmit(
    async () => {
      const payload = {
        name: name.trim(),
        institution: institution.trim() || null,
        last_four: lastFour || null,
        limit_cents: limit ?? 0,
        closing_day: cd,
        due_day: dd,
        closing_day_rule: rule,
        pay_account_id: payAccount || null,
      };
      if (card) await updateCard(card.id, payload);
      else await insertCard(household.id, me.userId, payload);
    },
    {
      successMessage: card ? 'Cartão atualizado.' : 'Cartão criado.',
      onSuccess: async () => {
        await refresh();
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = 'Dê um nome ao cartão.';
    if (lastFour && !/^\d{4}$/.test(lastFour)) err.last = 'Informe exatamente 4 dígitos.';
    if (limit === null) err.limit = 'Informe o limite total.';
    if (!closing || cd < 1 || cd > 31 || !Number.isInteger(cd))
      err.closing = 'Informe o dia de fechamento (1 a 31).';
    if (!due || dd < 1 || dd > 31 || !Number.isInteger(dd)) err.due = 'Informe o dia de vencimento (1 a 31).';
    setErrors(err);
    if (!Object.keys(err).length)
      void save.submit(JSON.stringify([name, institution, lastFour, limit, closing, due, rule, payAccount]));
  };
  return (
    <Modal title={card ? 'Editar cartão' : 'Novo cartão'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
          <Muted $small>
            Nunca guardamos o número completo, o CVV ou senhas — só os 4 últimos dígitos (opcional).
          </Muted>
          <FormGrid>
            <TextField
              label="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              maxLength={60}
            />
            <TextField
              label="Instituição (opcional)"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              maxLength={60}
            />
            <TextField
              label="Últimos 4 dígitos (opcional)"
              inputMode="numeric"
              maxLength={4}
              value={lastFour}
              onChange={(e) => setLastFour(e.target.value.replace(/\D/g, ''))}
              error={errors.last}
            />
            <MoneyField label="Limite total" value={limit} onChange={setLimit} error={errors.limit} />
            <TextField
              label="Dia do fechamento"
              type="number"
              min={1}
              max={31}
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
              error={errors.closing}
              hint="Dia em que a fatura fecha."
            />
            <TextField
              label="Dia do vencimento"
              type="number"
              min={1}
              max={31}
              value={due}
              onChange={(e) => setDue(e.target.value)}
              error={errors.due}
            />
            <SelectField
              label="Compra no dia do fechamento"
              value={rule}
              onChange={(e) => setRule(e.target.value as ClosingDayRule)}
              hint="Varia entre bancos — confira no app do seu cartão."
            >
              <option value="next">Vai para a fatura seguinte</option>
              <option value="current">Ainda entra na fatura que fecha</option>
            </SelectField>
            <AccountSelect
              label="Conta usada para pagar"
              mineOnly
              allowEmpty
              value={payAccount}
              onChange={setPayAccount}
            />
          </FormGrid>
          {example && (
            <Muted $small>
              Exemplo: uma compra de hoje entra na fatura que fecha em{' '}
              <strong>{formatDateBR(example.closingDate)}</strong> e vence em{' '}
              <strong>{formatDateBR(example.dueDate)}</strong>. Confira se bate com o seu cartão.
            </Muted>
          )}
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

function PayForm({
  invoice,
  cardName,
  outstanding,
  defaultAccount,
  onClose,
}: {
  invoice: Invoice;
  cardName: string;
  outstanding: Cents;
  defaultAccount: string;
  onClose: () => void;
}) {
  const { today, refresh } = useReadyHousehold();
  const [accountId, setAccountId] = useState(defaultAccount);
  const [amount, setAmount] = useState<Cents | null>(outstanding);
  const [date, setDate] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSubmit(
    async (_v: string, requestId: string) =>
      payInvoice({ invoiceId: invoice.id, requestId, accountId, amountCents: amount!, occurredOn: date }),
    {
      successMessage: 'Pagamento registrado.',
      onSuccess: async () => {
        await refresh();
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!accountId) err.account = 'Escolha a conta de onde sai o pagamento.';
    if (!amount || amount <= 0) err.amount = 'Informe um valor maior que zero.';
    else if (amount > outstanding) err.amount = 'O valor é maior que o saldo em aberto da fatura.';
    setErrors(err);
    if (!Object.keys(err).length) void save.submit(JSON.stringify([accountId, amount, date]));
  };
  return (
    <Modal title={`Pagar fatura — ${cardName}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
          <Muted $small>
            Vence em {formatDateBR(invoice.dueDate)}. Em aberto:{' '}
            <strong>
              <Amount cents={outstanding} />
            </strong>
            . Pagamento parcial não quita a fatura.
          </Muted>
          <AccountSelect
            label="Pagar com a conta"
            mineOnly
            value={accountId}
            onChange={setAccountId}
            error={errors.account}
          />
          <MoneyField label="Valor a pagar" value={amount} onChange={setAmount} error={errors.amount} />
          <TextField
            label="Data do pagamento"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {save.error && <FormError role="alert">{save.error}</FormError>}
          <Row $justify="flex-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.submitting}>
              Registrar pagamento
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}

export default function CardsPage() {
  const { data, today, me, nameOf, refresh } = useReadyHousehold();
  const [form, setForm] = useState<{ card?: CreditCard } | null>(null);
  const [pay, setPay] = useState<{ invoice: Invoice; card: CreditCard; outstanding: Cents } | null>(null);
  const [purchase, setPurchase] = useState<{ cardId: string; installment: boolean } | null>(null);
  const [del, setDel] = useState<CreditCard | null>(null);
  const remove = useSubmit(
    async () => {
      await deleteCard(del!.id);
    },
    {
      successMessage: 'Cartão excluído.',
      onSuccess: async () => {
        setDel(null);
        await refresh();
      },
    },
  );
  const toggle = useSubmit(async (c: CreditCard) => updateCard(c.id, { is_active: !c.isActive }), {
    successMessage: 'Cartão atualizado.',
    onSuccess: refresh,
  });

  return (
    <Stack $gap={20}>
      <PageHeader
        title="Cartões"
        subtitle="Limite, faturas, compras e parcelas."
        actions={
          <>
            <LinkButton as={Link} to="/importar" $variant="ghost">
              Importar fatura
            </LinkButton>
            <Button icon="plus" onClick={() => setForm({})}>
              Novo cartão
            </Button>
          </>
        }
      />
      {data.cards.length === 0 ? (
        <EmptyState
          icon="card"
          title="Nenhum cartão cadastrado"
          text="Informe limite, dia de fechamento e vencimento. Assim eu separo cada compra na fatura certa."
          action={
            <Button icon="plus" onClick={() => setForm({})}>
              Cadastrar cartão
            </Button>
          }
        />
      ) : (
        data.cards.map((card) => {
          const pos = cardPosition(card, data.invoices, data.transactions);
          const mine = card.ownerId === me.userId;
          const invs = data.invoices
            .filter((i) => i.cardId === card.id)
            .map((invoice) => {
              const totals = invoiceTotals(invoice, data.transactions);
              return { invoice, totals, status: invoiceStatus(invoice, totals, today) };
            })
            .filter((v) => v.totals.totalCents !== 0 || v.totals.paidCents !== 0 || v.status === 'open')
            .sort((a, b) => (a.invoice.dueDate < b.invoice.dueDate ? -1 : 1));
          const upcoming = invs.filter((v) => v.status !== 'paid');
          const past = invs
            .filter((v) => v.status === 'paid')
            .slice(-3)
            .reverse();
          const plans = data.plans.filter((p) => p.cardId === card.id);
          return (
            <Card key={card.id}>
              <Stack $gap={16}>
                <Row $wrap>
                  <Stack $gap={0}>
                    <h2 style={{ fontSize: 24 }}>
                      {card.name}
                      {card.lastFour ? ` ••${card.lastFour}` : ''}
                    </h2>
                    <Muted $small>
                      {nameOf(card.ownerId)} · fecha dia {card.closingDay}, vence dia {card.dueDay}
                      {card.institution ? ` · ${card.institution}` : ''}
                    </Muted>
                  </Stack>
                  <Spacer />
                  {!card.isActive && <Pill $tone="warning">Inativo</Pill>}
                </Row>

                <Stack $gap={6}>
                  <Row>
                    <Eyebrow>Limite disponível</Eyebrow>
                    <Spacer />
                    <Muted $small>
                      de <Amount cents={card.limitCents} />
                    </Muted>
                  </Row>
                  <p style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>
                    <Amount cents={pos.availableCents} tone={pos.availableCents < 0 ? 'negative' : 'plain'} />
                  </p>
                  <ProgressBar
                    label={`Limite usado de ${card.name}`}
                    pct={ratioPercent(pos.usedCents, card.limitCents)}
                    tone={
                      pos.availableCents < 0
                        ? 'danger'
                        : ratioPercent(pos.usedCents, card.limitCents) > 80
                          ? 'warning'
                          : 'accent'
                    }
                  />
                  <Muted $small>
                    Usado <Amount cents={pos.usedCents} /> (faturas em aberto, inclusive parcelas futuras)
                    {pos.pendingCents > 0 && (
                      <>
                        {' '}
                        · pendentes <Amount cents={pos.pendingCents} />
                      </>
                    )}
                  </Muted>
                </Stack>

                {mine && (
                  <Row $wrap $gap={8}>
                    <Button
                      small
                      onClick={() => setPurchase({ cardId: card.id, installment: false })}
                      icon="plus"
                    >
                      Compra
                    </Button>
                    <Button
                      small
                      variant="soft"
                      onClick={() => setPurchase({ cardId: card.id, installment: true })}
                    >
                      Compra parcelada
                    </Button>
                    <LinkButton as={Link} to={`/movimentacoes?cartao=${card.id}`} $small $variant="ghost">
                      Histórico
                    </LinkButton>
                    <Button small variant="ghost" onClick={() => setForm({ card })}>
                      Editar
                    </Button>
                    <Button small variant="ghost" onClick={() => void toggle.submit(card)}>
                      {card.isActive ? 'Desativar' : 'Reativar'}
                    </Button>
                    <Button small variant="danger" onClick={() => setDel(card)}>
                      Excluir
                    </Button>
                  </Row>
                )}

                <Stack $gap={4}>
                  <Eyebrow>Faturas</Eyebrow>
                  {upcoming.length === 0 && past.length === 0 ? (
                    <Muted>Nenhuma fatura ainda. As compras criam a fatura do ciclo automaticamente.</Muted>
                  ) : (
                    <PlainList>
                      {[...upcoming, ...past].map(({ invoice, totals, status }) => (
                        <ListItem key={invoice.id}>
                          <Stack $gap={2}>
                            <strong>
                              Fecha {formatDateBR(invoice.closingDate)} · vence{' '}
                              {formatDateBR(invoice.dueDate)}
                            </strong>
                            <Muted $small>
                              Compras <Amount cents={totals.purchasesCents} />
                              {totals.feesCents > 0 && (
                                <>
                                  {' '}
                                  · encargos <Amount cents={totals.feesCents} />
                                </>
                              )}
                              {totals.refundsCents > 0 && (
                                <>
                                  {' '}
                                  · estornos −<Amount cents={totals.refundsCents} />
                                </>
                              )}
                              {totals.paidCents > 0 && (
                                <>
                                  {' '}
                                  · pago <Amount cents={totals.paidCents} />
                                </>
                              )}
                            </Muted>
                          </Stack>
                          <Spacer />
                          <Stack $gap={4} style={{ alignItems: 'flex-end' }}>
                            <strong>
                              <Amount cents={totals.outstandingCents} />
                            </strong>
                            <Pill
                              $tone={
                                status === 'overdue'
                                  ? 'danger'
                                  : status === 'paid'
                                    ? 'positive'
                                    : status === 'partially_paid'
                                      ? 'warning'
                                      : 'default'
                              }
                            >
                              {INVOICE_STATUS_LABEL[status]}
                            </Pill>
                            {totals.outstandingCents > 0 && status !== 'paid' && (
                              <Button
                                small
                                variant="soft"
                                onClick={() =>
                                  setPay({ invoice, card, outstanding: totals.outstandingCents })
                                }
                              >
                                Pagar
                              </Button>
                            )}
                          </Stack>
                        </ListItem>
                      ))}
                    </PlainList>
                  )}
                </Stack>

                {plans.length > 0 && (
                  <Stack $gap={4}>
                    <Eyebrow>Parcelamentos ativos</Eyebrow>
                    <PlainList>
                      {plans.map((p) => {
                        const paidParcels = data.transactions.filter(
                          (t) => t.installmentPlanId === p.id && t.occurredOn <= today,
                        ).length;
                        return (
                          <ListItem key={p.id}>
                            <Stack $gap={0}>
                              <strong>{p.description}</strong>
                              <Muted $small>
                                {p.installmentCount}x · compra em {formatDateBR(p.purchaseDate)} ·{' '}
                                {Math.min(paidParcels, p.installmentCount)} de {p.installmentCount} já
                                reconhecidas
                              </Muted>
                            </Stack>
                            <Spacer />
                            <Amount cents={p.totalCents} />
                          </ListItem>
                        );
                      })}
                    </PlainList>
                    <Muted $small>
                      Para cancelar um parcelamento, exclua qualquer parcela em Movimentações.
                    </Muted>
                  </Stack>
                )}
              </Stack>
            </Card>
          );
        })
      )}

      {form && <CardForm card={form.card} onClose={() => setForm(null)} />}
      {pay && (
        <PayForm
          invoice={pay.invoice}
          cardName={pay.card.name}
          outstanding={pay.outstanding}
          defaultAccount={
            pay.card.payAccountId &&
            data.accounts.find((a) => a.id === pay.card.payAccountId)?.ownerId === me.userId
              ? pay.card.payAccountId
              : ''
          }
          onClose={() => setPay(null)}
        />
      )}
      {purchase && (
        <TransactionFormModal
          defaultKind={purchase.installment ? 'installment' : 'card'}
          defaultCardId={purchase.cardId}
          onClose={() => setPurchase(null)}
          onDone={() => undefined}
        />
      )}
      {del && (
        <ConfirmDialog
          title="Excluir cartão?"
          message={
            <>
              O cartão <strong>{del.name}</strong> será removido. Se houver compras ou faturas, o banco recusa
              — nesse caso use “Desativar”.
            </>
          }
          confirmLabel="Excluir"
          busy={remove.submitting}
          error={remove.error}
          onCancel={() => {
            setDel(null);
            remove.clearError();
          }}
          onConfirm={() => void remove.submit(del.id)}
        />
      )}
    </Stack>
  );
}
