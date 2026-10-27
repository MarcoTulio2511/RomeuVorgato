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
import { todayISO } from '../../domain/dates';
import { buildSnapshot, type HouseholdData, type Snapshot } from '../../domain/snapshot';
import type { ViewMode } from '../../domain/transactions/balances';
import { getMyMembership, loadBundle, type Membership } from '../../services/supabase/api';
import { friendlyError } from '../../services/supabase/errors';
import type { Household, Member } from '../../services/supabase/mappers';
import { useAuth } from '../auth/AuthProvider';

type Phase = 'loading' | 'no-household' | 'ready' | 'error';

export type ViewKey = 'joint' | 'me' | 'partner';

interface HouseholdApi {
  phase: Phase;
  error: string | null;
  household: Household | null;
  me: Member | null;
  members: Member[];
  partner: Member | null;
  data: HouseholdData | null;
  today: string;
  viewKey: ViewKey;
  setViewKey: (v: ViewKey) => void;
  view: ViewMode;
  snapshot: Snapshot | null;
  /** Recarrega tudo (depois de qualquer mutação). */
  refresh: () => Promise<void>;
  /** Recarrega a associação (depois de criar/entrar numa casa). */
  reloadMembership: () => Promise<void>;
  /** Nome de exibição pelo id do usuário. */
  nameOf: (userId: string | null | undefined) => string;
}

const Ctx = createContext<HouseholdApi | null>(null);
const VIEW_STORAGE_KEY = 'pierre-casa:view';

function useToday(): string {
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    const t = window.setInterval(() => setToday((cur) => (todayISO() === cur ? cur : todayISO())), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return today;
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const today = useToday();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [household, setHousehold] = useState<Household | null>(null);
  const [data, setData] = useState<HouseholdData | null>(null);
  const [viewKey, setViewKeyState] = useState<ViewKey>(() => {
    try {
      const v = window.localStorage.getItem(VIEW_STORAGE_KEY);
      return v === 'me' || v === 'partner' ? v : 'joint';
    } catch {
      return 'joint';
    }
  });
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const ticket = ++seq.current;
    try {
      const m = await getMyMembership(user.id);
      if (ticket !== seq.current) return;
      setMembership(m);
      if (!m) {
        setPhase('no-household');
        setData(null);
        return;
      }
      const bundle = await loadBundle(m.household, user.id, todayISO());
      if (ticket !== seq.current) return;
      setHousehold(bundle.household);
      setMembers(bundle.members);
      setData(bundle.data);
      setError(null);
      setPhase('ready');
    } catch (e) {
      if (ticket !== seq.current) return;
      setError(friendlyError(e));
      setPhase('error');
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      seq.current++;
      setPhase('loading');
      setData(null);
      setMembership(null);
      return;
    }
    setPhase('loading');
    void load();
  }, [user, load]);

  const me = useMemo(
    () => members.find((m) => m.userId === user?.id) ?? membership?.member ?? null,
    [members, membership, user],
  );
  const partner = useMemo(
    () => members.find((m) => m.isActive && m.userId !== user?.id) ?? null,
    [members, user],
  );

  const setViewKey = useCallback((v: ViewKey) => {
    setViewKeyState(v);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* preferência local opcional */
    }
  }, []);

  const effectiveKey: ViewKey = viewKey === 'partner' && !partner ? 'joint' : viewKey;
  const view = useMemo<ViewMode>(() => {
    if (effectiveKey === 'me' && user) return { kind: 'person', userId: user.id };
    if (effectiveKey === 'partner' && partner) return { kind: 'person', userId: partner.userId };
    return { kind: 'joint' };
  }, [effectiveKey, user, partner]);

  const snapshot = useMemo(() => (data ? buildSnapshot(data, today, view) : null), [data, today, view]);

  const nameOf = useCallback(
    (id: string | null | undefined) => members.find((m) => m.userId === id)?.displayName ?? 'Alguém',
    [members],
  );

  const value = useMemo<HouseholdApi>(
    () => ({
      phase,
      error,
      household,
      me,
      members,
      partner,
      data,
      today,
      viewKey: effectiveKey,
      setViewKey,
      view,
      snapshot,
      refresh: load,
      reloadMembership: load,
      nameOf,
    }),
    [
      phase,
      error,
      household,
      me,
      members,
      partner,
      data,
      today,
      effectiveKey,
      setViewKey,
      view,
      snapshot,
      load,
      nameOf,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHousehold fora do HouseholdProvider');
  return v;
}

/** Atalho para páginas que só renderizam com a casa carregada. */
export function useReadyHousehold() {
  const h = useHousehold();
  if (h.phase !== 'ready' || !h.data || !h.household || !h.me || !h.snapshot)
    throw new Error('Casa ainda não carregada');
  return { ...h, data: h.data, household: h.household, me: h.me, snapshot: h.snapshot };
}
