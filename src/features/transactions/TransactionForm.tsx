import { useMemo, useState, type FormEvent } from 'react';
import { buildInstallmentSchedule } from '../../domain/installments/installments';
import { formatDateBR, isValidISODate } from '../../domain/dates';
import { formatBRL, type Cents } from '../../domain/money/money';
import type { Scope, Transaction } from '../../domain/types';
import { Modal } from '../../components/ui/Modal';
import {
  Button,
  CheckRow,
  FormError,
  FormGrid,
  MoneyField,
  Muted,
  Row,
  Segmented,
  SelectField,
  Stack,
  TextAreaField,
  TextField,
} from '../../components/ui/primitives';
import { useSubmit } from '../../hooks/useSubmit';
import {
  createInstallmentPurchase,
  createTransaction,
  createTransfer,
  updateTransaction,
} from '../../services/supabase/api';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { AccountSelect, CardSelect, CategorySelect } from '../shared/pickers';

export type Kind = 'expense' | 'income' | 'transfer' | 'card' | 'installment';
const KIND_OPTIONS: Array<{ value: Kind; label: string }> = [
  { value: 'expense', label: 'Despesa' },
  { value: 'income', label: 'Receita' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'card', label: 'Cartão' },
  { value: 'installment', label: 'Parcelado' },
];

interface Props {
  /** Edição de um lançamento existente (tipo e vínculos fixos). */
  editing?: Transaction;
  defaultKind?: Kind;
  defaultAccountId?: string;
  defaultCardId?: string;
  onClose: () => void;
  onDone: () => void;
}

export function TransactionFormModal({
  editing,
  defaultKind = 'expense',
  defaultAccountId,
  defaultCardId,
  onClose,
  onDone,
}: Props) {
  const { household, data, me, today, refresh } = useReadyHousehold();
  const myAccounts = data.accounts.filter((a) => a.isActive && a.ownerId === me.userId);
  const myCards = data.cards.filter((c) => c.isActive && c.ownerId === me.userId);

  const editKind: Kind | null = editing
    ? editing.type === 'income'
      ? 'income'
      : editing.type.startsWith('transfer')
        ? 'transfer'
        : editing.type === 'card_purchase' && editing.installmentPlanId
          ? 'installment'
          : editing.cardId
            ? 'card'
            : 'expense'
    : null;
  const [kind, setKind] = useState<Kind>(editKind ?? defaultKind);
  const [amount, setAmount] = useState<Cents | null>(editing?.amountCents ?? null);
  const [date, setDate] = useState(editing?.occurredOn ?? today);
  const [description, setDescription] = useState(editing?.description.replace(/ \(\d+\/\d+\)$/, '') ?? '');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '');
  const [scope, setScope] = useState<Scope>(editing?.scope ?? 'individual');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [accountId, setAccountId] = useState(
    editing?.accountId ?? defaultAccountId ?? myAccounts[0]?.id ?? '',
  );
  const [toAccountId, setToAccountId] = useState('');
  const [cardId, setCardId] = useState(editing?.cardId ?? defaultCardId ?? myCards[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [count, setCount] = useState(2);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isParcel = !!editing?.installmentPlanId;
  const isTransfer = kind === 'transfer';
  const categoryKind = kind === 'income' ? 'income' : 'expense';
  const card = data.cards.find((c) => c.id === cardId);

  const schedule = useMemo(() => {
    if (kind !== 'installment' || !card || !amount || amount <= 0 || !isValidISODate(date)) return null;
    try {
      return buildInstallmentSchedule(card, date, amount, count);
    } catch {
      return null;
    }
  }, [kind, card, amount, date, count]);

  const finish = async () => {
    await refresh();
    onDone();
    onClose();
  };

  const save = useSubmit(
    async (_v: string, requestId: string) => {
      const base = { householdId: household.id, requestId };
      const common = {
        amountCents: amount!,
        occurredOn: date,
        description: description.trim(),
        categoryId: categoryId || null,
        scope,
        notes: notes.trim() || null,
      };
      if (editing) {
        return updateTransaction({
          id: editing.id,
          description: description.trim(),
          categoryId: categoryId || null,
          clearCategory: !categoryId && !!editing.categoryId,
          notes: notes.trim() || undefined,
          scope,
          ...(isParcel ? {} : { amountCents: amount!, occurredOn: date }),
          ...(!isParcel && accountId && accountId !== editing.accountId && editing.accountId
            ? { accountId }
            : {}),
        });
      }
      switch (kind) {
        case 'expense':
          return createTransaction({ ...base, ...common, type: 'expense', accountId, cardId: null });
        case 'income':
          return createTransaction({ ...base, ...common, type: 'income', accountId, cardId: null });
        case 'card':
          return createTransaction({
            ...base,
            ...common,
            type: 'card_purchase',
            accountId: null,
            cardId,
            status: pending ? 'pending' : 'posted',
          });
        case 'transfer':
          return createTransfer({
            ...base,
            from: accountId,
            to: toAccountId,
            amountCents: amount!,
            occurredOn: date,
            description: description.trim() || 'Transferência',
          });
        case 'installment':
          return createInstallmentPurchase({
            ...base,
            cardId,
            description: description.trim(),
            totalCents: amount!,
            installments: count,
            purchaseDate: date,
            categoryId: categoryId || null,
            scope,
            notes: notes.trim() || null,
          });
      }
    },
    { successMessage: editing ? 'Lançamento atualizado.' : 'Lançamento salvo.', onSuccess: finish },
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!amount || amount <= 0) err.amount = 'Informe um valor maior que zero.';
    if (!isValidISODate(date)) err.date = 'Informe uma data válida.';
    if (!isTransfer && !description.trim()) err.description = 'Descreva o lançamento.';
    if (!editing) {
      if (['expense', 'income', 'transfer'].includes(kind) && !accountId)
        err.account = myAccounts.length ? 'Escolha a conta.' : 'Cadastre uma conta primeiro.';
      if (['card', 'installment'].includes(kind) && !cardId)
        err.card = myCards.length ? 'Escolha o cartão.' : 'Cadastre um cartão primeiro.';
      if (isTransfer && !toAccountId) err.to = 'Escolha a conta de destino.';
      if (kind === 'installment' && !schedule)
        err.amount = err.amount ?? 'Valor insuficiente para essa quantidade de parcelas.';
    }
    setErrors(err);
    if (Object.keys(err).length === 0)
      void save.submit(
        JSON.stringify({
          kind,
          amount,
          date,
          description,
          categoryId,
          scope,
          notes,
          accountId,
          toAccountId,
          cardId,
          pending,
          count,
        }),
      );
  };

  const lockedAmount = isParcel;
  return (
    <Modal title={editing ? 'Editar lançamento' : 'Nova movimentação'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          {!editing && (
            <Segmented label="Tipo de lançamento" value={kind} onChange={setKind} options={KIND_OPTIONS} />
          )}
          {isParcel && (
            <Muted $small>
              Parcelas têm valor e data fixos. Para mudar, cancele o parcelamento e lance de novo.
            </Muted>
          )}
          <FormGrid>
            <MoneyField
              label={kind === 'installment' && !editing ? 'Valor total da compra' : 'Valor'}
              value={amount}
              onChange={setAmount}
              error={errors.amount}
              disabled={lockedAmount}
            />
            <TextField
              label={kind === 'installment' && !editing ? 'Data da compra' : 'Data'}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              error={errors.date}
              disabled={lockedAmount}
            />
            {!isTransfer && (
              <div className="span-2">
                <TextField
                  label="Descrição"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  error={errors.description}
                  maxLength={180}
                />
              </div>
            )}
            {isTransfer && (
              <div className="span-2">
                <TextField
                  label="Descrição (opcional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={180}
                />
              </div>
            )}

            {(['expense', 'income', 'transfer'].includes(kind) ||
              (editing && editing.accountId && !isTransfer)) &&
              !(editing && isTransfer) && (
                <AccountSelect
                  label={isTransfer ? 'Conta de origem' : 'Conta'}
                  mineOnly
                  value={accountId}
                  onChange={setAccountId}
                  error={errors.account}
                />
              )}
            {isTransfer && !editing && (
              <AccountSelect
                label="Conta de destino"
                value={toAccountId}
                onChange={setToAccountId}
                exclude={accountId}
                error={errors.to}
              />
            )}
            {['card', 'installment'].includes(kind) && !editing && (
              <CardSelect label="Cartão" mineOnly value={cardId} onChange={setCardId} error={errors.card} />
            )}

            {!isTransfer && (
              <CategorySelect kind={categoryKind} value={categoryId} onChange={setCategoryId} />
            )}
            {!isTransfer && (
              <SelectField
                label="Quem gastou/recebeu"
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
                hint={
                  scope === 'shared'
                    ? 'Compartilhado: conta uma vez só, para o casal.'
                    : 'Individual: só aparece na visão de quem lançou.'
                }
              >
                <option value="individual">Individual</option>
                <option value="shared">Compartilhado</option>
              </SelectField>
            )}
            {kind === 'installment' && !editing && (
              <TextField
                label="Parcelas"
                type="number"
                min={2}
                max={48}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(48, Number(e.target.value) || 1)))}
              />
            )}
            {kind === 'card' && !editing && (
              <CheckRow>
                <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} />
                Compra pendente (ainda não confirmada pelo banco)
              </CheckRow>
            )}
            {!isTransfer && (
              <div className="span-2">
                <TextAreaField
                  label="Observações"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                />
              </div>
            )}
          </FormGrid>

          {schedule && (
            <Stack $gap={4} aria-label="Cronograma das parcelas">
              <Muted $small>
                <strong>Cronograma</strong> (soma exatamente {formatBRL(amount ?? 0)}):
              </Muted>
              {schedule.slice(0, 12).map((s) => (
                <Row key={s.number} $justify="space-between">
                  <Muted $small>
                    {s.number}/{count} · fatura vence {formatDateBR(s.invoice.dueDate)}
                  </Muted>
                  <span>{formatBRL(s.amountCents)}</span>
                </Row>
              ))}
              {schedule.length > 12 && <Muted $small>… e mais {schedule.length - 12} parcelas.</Muted>}
            </Stack>
          )}
          {save.error && <FormError role="alert">{save.error}</FormError>}
          <Row $justify="flex-end" $wrap>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.submitting}>
              {editing ? 'Salvar alterações' : 'Salvar'}
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}
