import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { PierreMascot } from '../../components/ui/PierreMascot';
import { Button, Card, FormError, Muted, Stack, TextField } from '../../components/ui/primitives';
import { friendlyError } from '../../services/supabase/errors';
import { useAuth } from './AuthProvider';

const Screen = styled.div`
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
`;
const Box = styled.div`
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;
const Center = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
`;
const Notice = styled.div<{ $tone?: 'ok' | 'warn' }>`
  padding: 12px 14px;
  border-radius: 16px;
  font-size: 14px;
  background: ${({ $tone }) => ($tone === 'ok' ? 'rgba(200,245,66,0.1)' : 'rgba(255,200,87,0.1)')};
  border: 1px solid ${({ $tone }) => ($tone === 'ok' ? 'rgba(200,245,66,0.3)' : 'rgba(255,200,87,0.35)')};
`;

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Screen>
      <Box>
        <Center>
          <PierreMascot size={72} />
          <h1 style={{ fontSize: 30 }}>{title}</h1>
          {subtitle && <Muted>{subtitle}</Muted>}
        </Center>
        <Card $pad={26}>{children}</Card>
      </Box>
    </Screen>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validateEmail = (v: string) => (EMAIL_RE.test(v.trim()) ? null : 'Informe um e-mail válido.');
export const validatePassword = (v: string) =>
  v.length >= 8 ? null : 'A senha deve ter pelo menos 8 caracteres.';

function useAuthForm<T>(action: (v: T) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (v: T) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action(v);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function LoginPage() {
  const { signIn, status, sessionExpired, clearExpired } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const { busy, error, run } = useAuthForm(async () => {
    await signIn(email, password);
  });

  if (status === 'signedIn') return <Navigate to={from} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = { email: validateEmail(email), password: password ? null : 'Informe a senha.' };
    setErrors(next);
    if (next.email || next.password) return;
    void run(undefined);
  };

  return (
    <AuthLayout title="Bem-vindos de volta" subtitle="Entre para ver a vida financeira de vocês.">
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          {sessionExpired && (
            <Notice $tone="warn" role="status">
              Sua sessão expirou por segurança. Entre novamente para continuar.{' '}
              <button
                type="button"
                onClick={clearExpired}
                style={{
                  background: 'none',
                  border: 0,
                  color: 'inherit',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                Dispensar
              </button>
            </Notice>
          )}
          <TextField
            label="E-mail"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <TextField
            label="Senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          {error && <FormError role="alert">{error}</FormError>}
          <Button type="submit" block loading={busy}>
            Entrar
          </Button>
          <Muted $small style={{ textAlign: 'center' }}>
            <Link to="/recuperar-senha">Esqueci a senha</Link> · <Link to="/cadastro">Criar conta</Link>
          </Muted>
        </Stack>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { signUp, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{
    email?: string | null;
    password?: string | null;
    confirm?: string | null;
  }>({});
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const { busy, error, run } = useAuthForm(async () => {
    const r = await signUp(email, password);
    if (r === 'confirm') setNeedsConfirm(true);
    else navigate('/comecar', { replace: true });
  });

  if (status === 'signedIn') return <Navigate to="/comecar" replace />;

  if (needsConfirm) {
    return (
      <AuthLayout title="Confira seu e-mail">
        <Stack>
          <Notice $tone="ok" role="status">
            Enviamos um link de confirmação para <strong>{email.trim()}</strong>. Depois de confirmar, volte e
            entre.
          </Notice>
          <Button block onClick={() => navigate('/entrar')}>
            Ir para o login
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = {
      email: validateEmail(email),
      password: validatePassword(password),
      confirm: confirm === password ? null : 'As senhas não conferem.',
    };
    setErrors(next);
    if (next.email || next.password || next.confirm) return;
    void run(undefined);
  };

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Cada pessoa tem a sua conta; depois vocês compartilham uma casa."
    >
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          <TextField
            label="E-mail"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <TextField
            label="Senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint="Mínimo de 8 caracteres."
          />
          <TextField
            label="Repita a senha"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
          />
          {error && <FormError role="alert">{error}</FormError>}
          <Button type="submit" block loading={busy}>
            Criar conta
          </Button>
          <Muted $small style={{ textAlign: 'center' }}>
            Já tem conta? <Link to="/entrar">Entrar</Link>
          </Muted>
        </Stack>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAuthForm(async () => {
    await requestPasswordReset(email);
    setSent(true);
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const v = validateEmail(email);
    setErr(v);
    if (!v) void run(undefined);
  };
  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos um link para você criar uma nova senha.">
      {sent ? (
        <Stack>
          {/* Mensagem neutra: não revela se o e-mail existe */}
          <Notice $tone="ok" role="status">
            Se houver uma conta com esse e-mail, o link de recuperação já está a caminho.
          </Notice>
          <Link to="/entrar">Voltar ao login</Link>
        </Stack>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <Stack>
            <TextField
              label="E-mail"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={err}
            />
            {error && <FormError role="alert">{error}</FormError>}
            <Button type="submit" block loading={busy}>
              Enviar link
            </Button>
            <Muted $small style={{ textAlign: 'center' }}>
              <Link to="/entrar">Voltar ao login</Link>
            </Muted>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { updatePassword, status, recovering } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({});
  const { busy, error, run } = useAuthForm(async () => {
    await updatePassword(password);
    navigate('/', { replace: true });
  });
  if (status === 'loading') return null;
  if (status !== 'signedIn' && !recovering) {
    return (
      <AuthLayout title="Link inválido ou expirado">
        <Stack>
          <Muted>Peça um novo link de recuperação.</Muted>
          <Link to="/recuperar-senha">Recuperar senha</Link>
        </Stack>
      </AuthLayout>
    );
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = {
      password: validatePassword(password),
      confirm: confirm === password ? null : 'As senhas não conferem.',
    };
    setErrors(next);
    if (!next.password && !next.confirm) void run(undefined);
  };
  return (
    <AuthLayout title="Nova senha">
      <form onSubmit={onSubmit} noValidate>
        <Stack>
          <TextField
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <TextField
            label="Repita a nova senha"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
          />
          {error && <FormError role="alert">{error}</FormError>}
          <Button type="submit" block loading={busy}>
            Salvar senha
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
