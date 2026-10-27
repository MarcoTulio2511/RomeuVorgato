import { useEffect, useState, type FormEvent } from 'react';
import { formatDateBR } from '../../domain/dates';
import { formatMoneyInput, parseMoneyInput } from '../../domain/money/money';
import type { Preferences } from '../../domain/snapshot';
import type { Category } from '../../domain/types';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import {
  Button,
  Card,
  CheckRow,
  Eyebrow,
  FormError,
  FormGrid,
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
  TextField,
} from '../../components/ui/primitives';
import { useToast } from '../../components/feedback/Toast';
import { useSubmit } from '../../hooks/useSubmit';
import {
  createInvitation,
  deleteCategory,
  insertCategory,
  listInvitations,
  reassignCategory,
  removeMember,
  revokeInvitation,
  savePreferences,
  updateCategory,
  updateHousehold,
  updateMyDisplayName,
  type InvitationRow,
} from '../../services/supabase/api';
import { friendlyError } from '../../services/supabase/errors';
import { useAuth } from '../auth/AuthProvider';
import { validatePassword } from '../auth/AuthPages';
import { useReadyHousehold } from '../household/HouseholdProvider';
import { categoryOptions } from '../shared/pickers';
import { TX_LABEL } from '../shared/labels';

function download(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injeção de fórmula em planilhas
  return `"${s.replace(/"/g, '""')}"`;
};

function CategoryForm({ category, onClose }: { category?: Category; onClose: () => void }) {
  const { household, data, refresh } = useReadyHousehold();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<Category['kind']>(category?.kind ?? 'expense');
  const [parentId, setParentId] = useState(category?.parentId ?? '');
  const [color, setColor] = useState(category?.color ?? '#c8f542');
  const [error, setError] = useState('');
  const save = useSubmit(
    async () => {
      if (category)
        await updateCategory(category.id, { name: name.trim(), color, parent_id: parentId || null });
      else
        await insertCategory(household.id, { name: name.trim(), kind, parent_id: parentId || null, color });
    },
    {
      successMessage: 'Categoria salva.',
      onSuccess: async () => {
        await refresh();
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Dê um nome à categoria.');
    setError('');
    void save.submit(JSON.stringify([name, kind, parentId, color]));
  };
  return (
    <Modal title={category ? 'Editar categoria' : 'Nova categoria'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Stack>
          <FormGrid>
            <TextField
              label="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={error}
              maxLength={60}
            />
            {!category && (
              <SelectField
                label="Tipo"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Category['kind']);
                  setParentId('');
                }}
              >
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
              </SelectField>
            )}
            <SelectField
              label="Subcategoria de (opcional)"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">— nenhuma —</option>
              {categoryOptions(
                data.categories.filter((c) => c.parentId === null && c.id !== category?.id),
                category?.kind ?? kind,
                parentId,
              )}
            </SelectField>
            <TextField label="Cor" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
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

export default function SettingsPage() {
  const { household, data, me, members, partner, refresh, today } = useReadyHousehold();
  const { user, updatePassword, signOut } = useAuth();
  const toast = useToast();
  const isAdmin = me.role === 'admin';

  const [name, setName] = useState(me.displayName);
  const [houseName, setHouseName] = useState(household.name);
  const [goal, setGoal] = useState(
    household.monthlySavingsGoalCents === null ? '' : formatMoneyInput(household.monthlySavingsGoalCents),
  );
  const [prefs, setPrefs] = useState<Preferences>(data.prefs);
  const [invites, setInvites] = useState<InvitationRow[]>([]);
  const [fresh, setFresh] = useState<{ token: string; expires: string } | null>(null);
  const [catForm, setCatForm] = useState<{ category?: Category } | null>(null);
  const [delCat, setDelCat] = useState<Category | null>(null);
  const [mergeTo, setMergeTo] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [rmMember, setRmMember] = useState<string | null>(null);

  const loadInvites = () => {
    if (isAdmin)
      listInvitations(household.id)
        .then(setInvites)
        .catch(() => undefined);
  };
  useEffect(loadInvites, [household.id, isAdmin]);

  const saveName = useSubmit(async () => updateMyDisplayName(me.id, name.trim()), {
    successMessage: 'Nome atualizado.',
    onSuccess: refresh,
  });
  const saveHouse = useSubmit(
    async () => {
      const cents = goal.trim() ? parseMoneyInput(goal) : null;
      if (goal.trim() && cents === null) throw new Error('Meta inválida');
      await updateHousehold(household.id, { name: houseName.trim(), monthly_savings_goal_cents: cents });
    },
    { successMessage: 'Casa atualizada.', onSuccess: refresh },
  );
  const savePrefs = useSubmit(async () => savePreferences(user!.id, household.id, prefs), {
    successMessage: 'Preferências salvas.',
    onSuccess: refresh,
  });
  const invite = useSubmit(async () => {
    const r = await createInvitation(household.id, null, 168);
    setFresh({ token: r.token, expires: r.expires_at });
    loadInvites();
  });
  const revoke = useSubmit(async (id: string) => revokeInvitation(id), {
    successMessage: 'Convite revogado.',
    onSuccess: async () => loadInvites(),
  });
  const removeM = useSubmit(async () => removeMember(rmMember!), {
    successMessage: 'Membro removido.',
    onSuccess: async () => {
      setRmMember(null);
      await refresh();
    },
  });
  const pw = useSubmit(async () => updatePassword(newPw), {
    successMessage: 'Senha alterada.',
    onSuccess: () => setNewPw(''),
  });
  const archiveCat = useSubmit(async (c: Category) => updateCategory(c.id, { is_active: !c.isActive }), {
    successMessage: 'Categoria atualizada.',
    onSuccess: refresh,
  });
  const removeCat = useSubmit(
    async () => {
      if (mergeTo) await reassignCategory(delCat!.id, mergeTo);
      await deleteCategory(delCat!.id);
    },
    {
      successMessage: 'Categoria removida.',
      onSuccess: async () => {
        setDelCat(null);
        setMergeTo('');
        await refresh();
      },
    },
  );

  const link = fresh ? `${window.location.origin}/convite#t=${fresh.token}` : '';
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copiado.');
    } catch {
      toast.error('Não foi possível copiar. Selecione e copie manualmente.');
    }
  };

  const exportCsv = () => {
    const cat = new Map(data.categories.map((c) => [c.id, c.name]));
    const acc = new Map(data.accounts.map((a) => [a.id, a.name]));
    const card = new Map(data.cards.map((c) => [c.id, c.name]));
    const who = new Map(members.map((m) => [m.userId, m.displayName]));
    const lines = [
      ['Data', 'Tipo', 'Descrição', 'Valor (R$)', 'Categoria', 'Conta/Cartão', 'Titular', 'Escopo', 'Status']
        .map(csvCell)
        .join(';'),
    ];
    for (const t of data.transactions) {
      lines.push(
        [
          t.occurredOn,
          TX_LABEL[t.type],
          t.description,
          formatMoneyInput(t.amountCents),
          cat.get(t.categoryId ?? '') ?? '',
          acc.get(t.accountId ?? '') ?? card.get(t.cardId ?? '') ?? '',
          who.get(t.ownerId) ?? '',
          t.scope === 'shared' ? 'compartilhada' : 'individual',
          t.status,
        ]
          .map(csvCell)
          .join(';'),
      );
    }
    download(
      `pierre-casa-movimentacoes-${today}.csv`,
      'text/csv;charset=utf-8',
      `\uFEFF${lines.join('\r\n')}`,
    );
  };
  const exportJson = () =>
    download(
      `pierre-casa-backup-${today}.json`,
      'application/json',
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          household: household.name,
          ...data,
          currentUserId: undefined,
        },
        null,
        2,
      ),
    );

  const roots = data.categories.filter((c) => c.parentId === null);
  return (
    <Stack $gap={20}>
      <PageHeader title="Configurações" subtitle="Perfil, casa, categorias, preferências e exportação." />

      <Grid $min={340}>
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void saveName.submit(name);
            }}
            noValidate
          >
            <Stack>
              <Eyebrow>Seu perfil</Eyebrow>
              <TextField
                label="Nome de exibição"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
              <Muted $small>E-mail: {user?.email}</Muted>
              {saveName.error && <FormError role="alert">{saveName.error}</FormError>}
              <Row>
                <Button
                  type="submit"
                  loading={saveName.submitting}
                  disabled={!name.trim() || name.trim() === me.displayName}
                >
                  Salvar nome
                </Button>
              </Row>
            </Stack>
          </form>
        </Card>
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const e1 = validatePassword(newPw);
              setPwErr(e1);
              if (!e1) void pw.submit(newPw);
            }}
            noValidate
          >
            <Stack>
              <Eyebrow>Alterar senha</Eyebrow>
              <TextField
                label="Nova senha"
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                error={pwErr}
                hint="Mínimo de 8 caracteres."
              />
              {pw.error && <FormError role="alert">{pw.error}</FormError>}
              <Row>
                <Button type="submit" variant="ghost" loading={pw.submitting}>
                  Alterar senha
                </Button>
              </Row>
            </Stack>
          </form>
        </Card>
      </Grid>

      <Card>
        <Stack>
          <Eyebrow>Casa e membros</Eyebrow>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (houseName.trim()) void saveHouse.submit(houseName + goal);
            }}
            noValidate
          >
            <Stack>
              <FormGrid>
                <TextField
                  label="Nome da casa"
                  value={houseName}
                  onChange={(e) => setHouseName(e.target.value)}
                  disabled={!isAdmin}
                  maxLength={80}
                />
                <TextField
                  label="Meta de economia mensal (opcional)"
                  inputMode="decimal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  disabled={!isAdmin}
                  placeholder="0,00"
                  hint="Usada pelo Pierre para avisar se a meta está em risco."
                />
              </FormGrid>
              {saveHouse.error && (
                <FormError role="alert">
                  {saveHouse.error.includes('Meta')
                    ? 'Meta inválida. Use o formato 1.234,56'
                    : saveHouse.error}
                </FormError>
              )}
              {isAdmin ? (
                <Row>
                  <Button type="submit" loading={saveHouse.submitting}>
                    Salvar casa
                  </Button>
                </Row>
              ) : (
                <Muted $small>Somente administradores alteram os dados da casa.</Muted>
              )}
            </Stack>
          </form>
          <PlainList>
            {members
              .filter((m) => m.isActive)
              .map((m) => (
                <ListItem key={m.id}>
                  <strong>{m.displayName}</strong>
                  <Pill $tone={m.role === 'admin' ? 'accent' : 'default'}>
                    {m.role === 'admin' ? 'Administrador' : 'Membro'}
                  </Pill>
                  {m.userId === me.userId && <Pill $tone="info">Você</Pill>}
                  <Spacer />
                  {isAdmin && m.userId !== me.userId && (
                    <Button small variant="danger" onClick={() => setRmMember(m.id)}>
                      Remover
                    </Button>
                  )}
                </ListItem>
              ))}
          </PlainList>
          {isAdmin && (
            <Stack $gap={10}>
              <Row $wrap>
                <Muted $small>
                  Cada casa comporta {household.maxMembers} membros.{' '}
                  {partner ? 'A casa está completa.' : 'Convide a outra pessoa:'}
                </Muted>
                <Spacer />
                {!partner && (
                  <Button
                    variant="soft"
                    loading={invite.submitting}
                    onClick={() => void invite.submit('novo')}
                  >
                    Gerar convite
                  </Button>
                )}
              </Row>
              {invite.error && <FormError role="alert">{invite.error}</FormError>}
              {fresh && (
                <Card $pad={16} $tone="accent">
                  <Stack $gap={8}>
                    <strong>Convite criado — mostrado só agora</strong>
                    <Muted $small>
                      Envie o link ou o código por um canal privado. Vale até{' '}
                      {formatDateBR(fresh.expires.slice(0, 10))} e só pode ser usado uma vez. Não guardamos o
                      código: se perder, gere outro.
                    </Muted>
                    <TextField label="Link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                    <Row $wrap>
                      <Button small onClick={() => void copy(link)}>
                        Copiar link
                      </Button>
                      <Button small variant="ghost" onClick={() => void copy(fresh.token)}>
                        Copiar só o código
                      </Button>
                      <Button small variant="ghost" onClick={() => setFresh(null)}>
                        Ocultar
                      </Button>
                    </Row>
                  </Stack>
                </Card>
              )}
              {invites.length > 0 && (
                <PlainList>
                  {invites.slice(0, 6).map((i) => {
                    const state = i.usedAt
                      ? 'Usado'
                      : i.revokedAt
                        ? 'Revogado'
                        : new Date(i.expiresAt) < new Date()
                          ? 'Expirado'
                          : 'Pendente';
                    return (
                      <ListItem key={i.id}>
                        <Muted $small>Criado em {formatDateBR(i.createdAt.slice(0, 10))}</Muted>
                        <Pill $tone={state === 'Pendente' ? 'warning' : 'default'}>{state}</Pill>
                        <Spacer />
                        {state === 'Pendente' && (
                          <Button small variant="ghost" onClick={() => void revoke.submit(i.id)}>
                            Revogar
                          </Button>
                        )}
                      </ListItem>
                    );
                  })}
                </PlainList>
              )}
            </Stack>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack>
          <Row>
            <Eyebrow>Categorias</Eyebrow>
            <Spacer />
            <Button small icon="plus" onClick={() => setCatForm({})}>
              Nova
            </Button>
          </Row>
          <PlainList>
            {roots
              .flatMap((r) => [r, ...data.categories.filter((c) => c.parentId === r.id)])
              .map((c) => (
                <ListItem key={c.id} style={{ flexWrap: 'wrap', paddingLeft: c.parentId ? 20 : 0 }}>
                  <span
                    aria-hidden="true"
                    style={{ width: 12, height: 12, borderRadius: 4, background: c.color, flex: 'none' }}
                  />
                  <strong>{c.name}</strong>
                  <Pill>{{ expense: 'Despesa', income: 'Receita', transfer: 'Transferência' }[c.kind]}</Pill>
                  {!c.isActive && <Pill $tone="warning">Inativa</Pill>}
                  <Spacer />
                  <Button small variant="ghost" onClick={() => setCatForm({ category: c })}>
                    Editar
                  </Button>
                  <Button small variant="ghost" onClick={() => void archiveCat.submit(c)}>
                    {c.isActive ? 'Desativar' : 'Reativar'}
                  </Button>
                  <Button
                    small
                    variant="danger"
                    onClick={() => {
                      setDelCat(c);
                      setMergeTo('');
                    }}
                  >
                    Excluir
                  </Button>
                </ListItem>
              ))}
          </PlainList>
          <Muted $small>
            Categorias em uso não são apagadas de forma destrutiva: desative ou reclassifique os lançamentos
            para outra categoria.
          </Muted>
        </Stack>
      </Card>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void savePrefs.submit(JSON.stringify(prefs));
          }}
        >
          <Stack>
            <Eyebrow>Preferências financeiras e do Pierre</Eyebrow>
            <FormGrid>
              <CheckRow>
                <input
                  type="checkbox"
                  checked={prefs.pierreEnabled}
                  onChange={(e) => setPrefs({ ...prefs, pierreEnabled: e.target.checked })}
                />
                Pierre ativo (mensagens e alertas)
              </CheckRow>
              <SelectField
                label="Parcelas nos relatórios"
                value={prefs.installmentPolicy}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    installmentPolicy: e.target.value as Preferences['installmentPolicy'],
                  })
                }
              >
                <option value="parcel">Parcela a parcela (mês de cada parcela)</option>
                <option value="purchase">Total na data da compra</option>
              </SelectField>
              <TextField
                label="Meses mínimos de histórico para comparar"
                type="number"
                min={2}
                max={12}
                value={prefs.pierreMinPeriods}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    pierreMinPeriods: Math.max(2, Math.min(12, Number(e.target.value) || 3)),
                  })
                }
              />
              <TextField
                label="Aviso de gasto acima do padrão (%)"
                type="number"
                min={5}
                max={300}
                value={prefs.historyVariancePct}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    historyVariancePct: Math.max(5, Math.min(300, Number(e.target.value) || 30)),
                  })
                }
              />
              <TextField
                label="Alerta padrão de orçamento (%)"
                type="number"
                min={1}
                max={100}
                value={prefs.defaultAlertPct}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    defaultAlertPct: Math.max(1, Math.min(100, Number(e.target.value) || 80)),
                  })
                }
              />
            </FormGrid>
            {savePrefs.error && <FormError role="alert">{savePrefs.error}</FormError>}
            <Row>
              <Button type="submit" loading={savePrefs.submitting}>
                Salvar preferências
              </Button>
            </Row>
          </Stack>
        </form>
      </Card>

      <Card>
        <Stack>
          <Eyebrow>Exportar dados</Eyebrow>
          <Muted $small>
            Gera os arquivos no seu navegador. Eles contêm dados financeiros: guarde com cuidado.
          </Muted>
          <Row $wrap>
            <Button variant="ghost" icon="download" onClick={exportCsv}>
              Movimentações (CSV)
            </Button>
            <Button variant="ghost" icon="download" onClick={exportJson}>
              Backup completo (JSON)
            </Button>
          </Row>
        </Stack>
      </Card>

      <Row>
        <Button
          variant="danger"
          icon="logout"
          onClick={() => void signOut().catch((e) => toast.error(friendlyError(e)))}
        >
          Sair da conta
        </Button>
      </Row>

      {catForm && <CategoryForm category={catForm.category} onClose={() => setCatForm(null)} />}
      {delCat && (
        <ConfirmDialog
          title="Excluir categoria?"
          confirmLabel="Excluir"
          busy={removeCat.submitting}
          error={removeCat.error}
          message={
            <Stack $gap={10}>
              <span>
                “{delCat.name}” será removida. Se houver lançamentos nela, escolha para onde movê-los (ou use
                “Desativar”).
              </span>
              <SelectField
                label="Mover lançamentos para"
                value={mergeTo}
                onChange={(e) => setMergeTo(e.target.value)}
              >
                <option value="">Não mover (só exclui se não estiver em uso)</option>
                {categoryOptions(
                  data.categories.filter((c) => c.id !== delCat.id),
                  delCat.kind,
                )}
              </SelectField>
            </Stack>
          }
          onCancel={() => {
            setDelCat(null);
            removeCat.clearError();
          }}
          onConfirm={() => void removeCat.submit(delCat.id + mergeTo)}
        />
      )}
      {rmMember && (
        <ConfirmDialog
          title="Remover membro?"
          message="A pessoa perde o acesso à casa. Os lançamentos dela permanecem no histórico."
          confirmLabel="Remover"
          busy={removeM.submitting}
          error={removeM.error}
          onCancel={() => {
            setRmMember(null);
            removeM.clearError();
          }}
          onConfirm={() => void removeM.submit(rmMember)}
        />
      )}
    </Stack>
  );
}
