import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/feedback/Toast';
import { PierreMascot } from '../../components/ui/PierreMascot';
import { Button, Card, FormError, Grid, Muted, Stack, TextField } from '../../components/ui/primitives';
import { useSubmit } from '../../hooks/useSubmit';
import { acceptInvitation, createHousehold } from '../../services/supabase/api';
import { useAuth } from '../auth/AuthProvider';
import { useHousehold } from './HouseholdProvider';

function tokenFromHash(): string {
  const m = /[#&]t=([0-9a-fA-F]{32,128})/.exec(window.location.hash);
  return m?.[1] ?? '';
}

export function OnboardingPage() {
  const { phase, reloadMembership } = useHousehold();
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [houseName, setHouseName] = useState('');
  const [myName, setMyName] = useState('');
  const [token, setToken] = useState(tokenFromHash);
  const [joinName, setJoinName] = useState('');
  const [errs, setErrs] = useState<Record<string, string | null>>({});

  const finish = async () => {
    await reloadMembership();
    navigate('/', { replace: true });
  };
  const create = useSubmit(
    async (v: { name: string; display: string }) => createHousehold(v.name, v.display),
    { successMessage: 'Casa criada! Agora é só convidar a outra pessoa.', onSuccess: finish },
  );
  const join = useSubmit(
    async (v: { token: string; display: string }) => acceptInvitation(v.token, v.display),
    { successMessage: 'Você entrou na casa!', onSuccess: finish },
  );

  if (phase === 'ready') return <Navigate to="/" replace />;

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    const next = {
      houseName: houseName.trim() ? null : 'Dê um nome à casa.',
      myName: myName.trim() ? null : 'Como devemos chamar você?',
    };
    setErrs((s) => ({ ...s, ...next }));
    if (!next.houseName && !next.myName)
      void create.submit({ name: houseName.trim(), display: myName.trim() });
  };
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    const t = token.trim();
    const next = {
      token: /^[0-9a-fA-F]{32,128}$/.test(t) ? null : 'Cole o código completo do convite.',
      joinName: joinName.trim() ? null : 'Como devemos chamar você?',
    };
    setErrs((s) => ({ ...s, ...next }));
    if (!next.token && !next.joinName) void join.submit({ token: t, display: joinName.trim() });
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 16px 64px' }}>
      <Stack $gap={28}>
        <Stack $gap={10} style={{ alignItems: 'center', textAlign: 'center' }}>
          <PierreMascot size={80} />
          <h1 style={{ fontSize: 34 }}>Vamos montar a casa de vocês</h1>
          <Muted>Uma casa reúne as finanças dos dois. Cada um mantém as próprias contas e cartões.</Muted>
        </Stack>
        <Grid $min={320}>
          <Card>
            <form onSubmit={onCreate} noValidate>
              <Stack>
                <h2 style={{ fontSize: 22 }}>Criar uma casa</h2>
                <TextField
                  label="Nome da casa"
                  placeholder="Ex.: Casa da Ana e do Bruno"
                  value={houseName}
                  onChange={(e) => setHouseName(e.target.value)}
                  error={errs.houseName}
                  maxLength={80}
                />
                <TextField
                  label="Seu nome"
                  autoComplete="given-name"
                  value={myName}
                  onChange={(e) => setMyName(e.target.value)}
                  error={errs.myName}
                  maxLength={60}
                />
                {create.error && <FormError role="alert">{create.error}</FormError>}
                <Button type="submit" loading={create.submitting}>
                  Criar casa
                </Button>
              </Stack>
            </form>
          </Card>
          <Card>
            <form onSubmit={onJoin} noValidate>
              <Stack>
                <h2 style={{ fontSize: 22 }}>Entrar com convite</h2>
                <TextField
                  label="Código do convite"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  error={errs.token}
                  autoComplete="off"
                  spellCheck={false}
                />
                <TextField
                  label="Seu nome"
                  autoComplete="given-name"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  error={errs.joinName}
                  maxLength={60}
                />
                {join.error && <FormError role="alert">{join.error}</FormError>}
                <Button type="submit" variant="ghost" loading={join.submitting}>
                  Entrar na casa
                </Button>
              </Stack>
            </form>
          </Card>
        </Grid>
        <Muted $small style={{ textAlign: 'center' }}>
          Conectado como {user?.email}.{' '}
          <button
            type="button"
            onClick={() => void signOut().catch(() => toast.error('Não foi possível sair.'))}
            style={{
              background: 'none',
              border: 0,
              color: 'inherit',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Sair
          </button>
        </Muted>
      </Stack>
    </div>
  );
}
