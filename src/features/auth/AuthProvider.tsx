import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { getClient, isSupabaseConfigured } from '../../services/supabase/client';
import { onSessionExpired, toAppError } from '../../services/supabase/errors';

export interface AuthUser {
  id: string;
  email: string;
}
type Status = 'loading' | 'signedOut' | 'signedIn' | 'unconfigured';

interface AuthApi {
  status: Status;
  user: AuthUser | null;
  /** true quando o servidor encerrou a sessão (token expirado/recusado) — a tela de login explica. */
  sessionExpired: boolean;
  recovering: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Devolve 'confirm' quando o projeto exige confirmação de e-mail antes do primeiro acesso. */
  signUp: (email: string, password: string) => Promise<'signedIn' | 'confirm'>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  clearExpired: () => void;
}

const Ctx = createContext<AuthApi | null>(null);

const toUser = (s: Session | null): AuthUser | null =>
  s?.user ? { id: s.user.id, email: s.user.email ?? '' } : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(isSupabaseConfigured ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const wasSignedIn = useRef(false);
  const manualSignOut = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const auth = getClient().auth;
    let active = true;
    void auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = toUser(data.session);
      wasSignedIn.current = !!u;
      setUser(u);
      setStatus(u ? 'signedIn' : 'signedOut');
    });
    const { data: sub } = auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      const u = toUser(session);
      if (event === 'SIGNED_OUT' && wasSignedIn.current && !manualSignOut.current) setSessionExpired(true);
      if (event === 'SIGNED_OUT') manualSignOut.current = false;
      wasSignedIn.current = !!u;
      setUser(u);
      setStatus(u ? 'signedIn' : 'signedOut');
    });
    const off = onSessionExpired(() => {
      if (!wasSignedIn.current) return;
      setSessionExpired(true);
      void getClient().auth.signOut({ scope: 'local' });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      off();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await getClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw toAppError(error);
    setSessionExpired(false);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await getClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/entrar` },
    });
    if (error) throw toAppError(error);
    return data.session ? 'signedIn' : 'confirm';
  }, []);

  const signOut = useCallback(async () => {
    manualSignOut.current = true;
    const { error } = await getClient().auth.signOut();
    if (error) {
      manualSignOut.current = false;
      throw toAppError(error);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await getClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    if (error) throw toAppError(error);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await getClient().auth.updateUser({ password });
    if (error) throw toAppError(error);
    setRecovering(false);
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      status,
      user,
      sessionExpired,
      recovering,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
      clearExpired: () => setSessionExpired(false),
    }),
    [status, user, sessionExpired, recovering, signIn, signUp, signOut, requestPasswordReset, updatePassword],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
