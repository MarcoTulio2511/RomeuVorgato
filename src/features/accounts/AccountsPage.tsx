import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { formatDateBR, isValidISODate } from '../../domain/dates';
import type { Cents } from '../../domain/money/money';
import { accountBalance } from '../../domain/transactions/balances';
import type { Account, AccountType } from '../../domain/types';
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
  Grid,
  LinkButton,
  MoneyField,
  Muted,
  PageHeader,
  Pill,
  Row,
  SelectField,
  Spacer,
  Stack,
  TextAreaField,
  TextField,
} from '../../components/ui/primitives';
import { useSubmit } from '../../hooks/useSubmit';
import { createTransaction, deleteAccount, insertAccount, updateAccount } from '../../services/supabase/api';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { ACCOUNT_TYPE_LABEL } from '../shared/labels';

function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { household, me, today, refresh } = useReadyHousehold();
  const [name, setName] = useState(account?.name ?? '');
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [balance, setBalance] = useState<Cents | null>(account?.initialBalanceCents ?? 0);
  const [balanceDate, setBalanceDate] = useState(account?.balanceDate ?? today);
  const [include, setInclude] = useState(account?.includeInConsolidated ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useSubmit(
    async () => {
      const payload = {
        name: name.trim(),
        institution: institution.trim() || null,
        type,
        initial_balance_cents: balance ?? 0,
        balance_date: balanceDate,
        include_in_consolidated: include,
      };
      if (account) await updateAccount(account.id, payload);
      else await insertAccount(household.id, me.userId, payload);
    },
    {
      successMessage: account ? 'Conta atualizada.' : 'Conta criada.',
      onSuccess: async () => {
        await refresh();
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = 'Dê um nome à conta.';
    if (balance === null) err.balance = 'Informe o saldo (pode ser 0,00).';
    if (!isValidISODate(balanceDate)) err.date = 'Data inválida.';
    setErrors(err);
    if (!Object.keys(err).length)
      void save.submit(JSON.stringify([name, institution, type, balance, balanceDate, include]));
  };
  return (
    <Modal title={account ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
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
            <SelectField label="Tipo" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </SelectField>
            <MoneyField
              label="Saldo inicial"
              value={balance}
              onChange={setBalance}
              error={errors.balance}
              hint="O saldo real da conta no início da data-base."
            />
            <TextField
              label="Data-base do saldo"
              type="date"
              value={balanceDate}
              onChange={(e) => setBalanceDate(e.target.value)}
              error={errors.date}
              hint="Movimentações anteriores a esta data não alteram o saldo."
            />
            <div className="span-2">
              <CheckRow>
                <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
                Incluir na visão conjunta do casal
              </CheckRow>
            </div>
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

/** Ajuste de saldo controlado: exige justificativa e fica na auditoria. */
function AdjustForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const { household, today, refresh } = useReadyHousehold();
  const [dir, setDir] = useState<'adjustment_in' | 'adjustment_out'>('adjustment_in');
  const [amount, setAmount] = useState<Cents | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSubmit(
    async (_v: string, requestId: string) =>
      createTransaction({
        householdId: household.id,
        requestId,
        type: dir,
        amountCents: amount!,
        occurredOn: today,
        description: 'Ajuste de saldo',
        categoryId: null,
        accountId: account.id,
        cardId: null,
        scope: 'individual',
        notes: reason.trim(),
      }),
    {
      successMessage: 'Ajuste registrado.',
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
    if (reason.trim().length < 3) err.reason = 'Explique o motivo do ajuste.';
    setErrors(err);
    if (!Object.keys(err).length) void save.submit(JSON.stringify([dir, amount, reason]));
  };
  return (
    <Modal title={`Ajustar saldo — ${account.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
          <Muted $small>
            Use quando o saldo do app não bate com o do banco. O ajuste fica registrado com a justificativa.
          </Muted>
          <SelectField
            label="Tipo de ajuste"
            value={dir}
            onChange={(e) => setDir(e.target.value as typeof dir)}
          >
            <option value="adjustment_in">Aumentar saldo (+)</option>
            <option value="adjustment_out">Reduzir saldo (−)</option>
          </SelectField>
          <MoneyField label="Valor do ajuste" value={amount} onChange={setAmount} error={errors.amount} />
          <TextAreaField
            label="Justificativa"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={errors.reason}
            maxLength={500}
          />
          {save.error && <FormError role="alert">{save.error}</FormError>}
          <Row $justify="flex-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.submitting}>
              Registrar ajuste
            </Button>
          </Row>
        </Stack>
      </form>
    </Modal>
  );
}

export default function AccountsPage() {
  const { data, today, me, nameOf, refresh } = useReadyHousehold();
  const [form, setForm] = useState<{ account?: Account } | null>(null);
  const [adjust, setAdjust] = useState<Account | null>(null);
  const [del, setDel] = useState<Account | null>(null);

  const toggle = useSubmit(async (a: Account) => updateAccount(a.id, { is_active: !a.isActive }), {
    successMessage: 'Conta atualizada.',
    onSuccess: refresh,
  });
  const remove = useSubmit(
    async () => {
      await deleteAccount(del!.id);
    },
    {
      successMessage: 'Conta excluída.',
      onSuccess: async () => {
        setDel(null);
        await refresh();
      },
    },
  );

  return (
    <Stack $gap={20}>
      <PageHeader
        title="Contas"
        subtitle="Contas bancárias e carteiras de cada pessoa."
        actions={
          <>
            <LinkButton as={Link} to="/importar" $variant="ghost">
              Importar extrato
            </LinkButton>
            <Button icon="plus" onClick={() => setForm({})}>
              Nova conta
            </Button>
          </>
        }
      />
      {data.accounts.length === 0 ? (
        <EmptyState
          icon="wallet"
          title="Nenhuma conta ainda"
          text="Cadastre sua conta com o saldo de hoje. Cada pessoa cadastra as próprias contas."
          action={
            <Button icon="plus" onClick={() => setForm({})}>
              Cadastrar conta
            </Button>
          }
        />
      ) : (
        <Grid $min={320}>
          {data.accounts.map((a) => {
            const bal = accountBalance(a, data.transactions, today);
            const mine = a.ownerId === me.userId;
            return (
              <Card key={a.id}>
                <Stack $gap={12}>
                  <Row $wrap $gap={8}>
                    <Eyebrow>{ACCOUNT_TYPE_LABEL[a.type]}</Eyebrow>
                    <Spacer />
                    {!a.isActive && <Pill $tone="warning">Arquivada</Pill>}
                    {!a.includeInConsolidated && <Pill>Fora do consolidado</Pill>}
                  </Row>
                  <Stack $gap={2}>
                    <h2 style={{ fontSize: 22 }}>{a.name}</h2>
                    <Muted $small>
                      {a.institution ? `${a.institution} · ` : ''}
                      {nameOf(a.ownerId)}
                    </Muted>
                  </Stack>
                  <p style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>
                    <Amount cents={bal} tone={bal < 0 ? 'negative' : 'plain'} />
                  </p>
                  <Muted $small>
                    Saldo inicial <Amount cents={a.initialBalanceCents} /> em {formatDateBR(a.balanceDate)}
                  </Muted>
                  <Row $wrap $gap={8}>
                    <LinkButton as={Link} to={`/movimentacoes?conta=${a.id}`} $small $variant="soft">
                      Histórico
                    </LinkButton>
                    {mine && (
                      <>
                        <Button small variant="ghost" onClick={() => setForm({ account: a })}>
                          Editar
                        </Button>
                        <Button small variant="ghost" onClick={() => setAdjust(a)}>
                          Ajustar saldo
                        </Button>
                        <Button small variant="ghost" onClick={() => void toggle.submit(a)}>
                          {a.isActive ? 'Arquivar' : 'Reativar'}
                        </Button>
                        <Button small variant="danger" onClick={() => setDel(a)}>
                          Excluir
                        </Button>
                      </>
                    )}
                  </Row>
                </Stack>
              </Card>
            );
          })}
        </Grid>
      )}
      {form && <AccountForm account={form.account} onClose={() => setForm(null)} />}
      {adjust && <AdjustForm account={adjust} onClose={() => setAdjust(null)} />}
      {del && (
        <ConfirmDialog
          title="Excluir conta?"
          message={
            <>
              A conta <strong>{del.name}</strong> será removida. Se ela já tem movimentações, o banco recusa —
              nesse caso, use “Arquivar”.
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
