import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pickHeadline, visibleMessages } from '../../domain/pierre/engine';
import type { MessageHistory, PierreMessage } from '../../domain/pierre/types';
import { loadPierreHistory, recordPierreMessage } from '../../services/supabase/api';
import { friendlyError } from '../../services/supabase/errors';
import { useAuth } from '../auth/AuthProvider';
import { useHousehold } from '../household/HouseholdProvider';

/**
 * Mensagens do Pierre = motor determinístico (snapshot) + histórico de exibição/dispensa persistido no banco.
 * O histórico só controla frequência; o conteúdo vem sempre dos dados atuais.
 */
export function usePierre() {
  const { user } = useAuth();
  const { snapshot, household } = useHousehold();
  const [history, setHistory] = useState<MessageHistory>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!user) return;
    let alive = true;
    loadPierreHistory(user.id)
      .then((rows) => {
        if (!alive) return;
        setHistory(
          Object.fromEntries(
            rows.map((r) => [
              r.dedupeKey,
              { lastShownAt: r.lastSeenAt, dismissedAt: r.dismissedAt, snoozedUntil: r.snoozedUntil },
            ]),
          ),
        );
      })
      .catch((e) => alive && setError(friendlyError(e)))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [user]);

  const all = useMemo(() => snapshot?.messages ?? [], [snapshot]);
  const nowMs = Date.now();
  const visible = useMemo(() => visibleMessages(all, history, nowMs), [all, history, nowMs]);
  const headline = useMemo(() => pickHeadline(all, history, nowMs), [all, history, nowMs]);

  const act = useCallback(
    async (m: PierreMessage, patch: { dismiss?: boolean; snoozeUntil?: string }) => {
      if (!user || !household) return;
      const now = new Date().toISOString();
      setHistory((h) => ({
        ...h,
        [m.dedupeKey]: {
          ...h[m.dedupeKey],
          lastShownAt: now,
          ...(patch.dismiss ? { dismissedAt: now } : {}),
          ...(patch.snoozeUntil ? { snoozedUntil: patch.snoozeUntil } : {}),
        },
      }));
      try {
        await recordPierreMessage(user.id, household.id, m, patch);
      } catch (e) {
        setError(friendlyError(e));
      }
    },
    [user, household],
  );

  /** Registra que a mensagem foi exibida (controle de frequência) — uma vez por sessão. */
  const markShown = useCallback(
    (m: PierreMessage | null) => {
      if (!m || shown.current.has(m.dedupeKey)) return;
      shown.current.add(m.dedupeKey);
      void act(m, {});
    },
    [act],
  );

  return {
    loaded,
    error,
    all,
    visible,
    headline,
    history,
    markShown,
    dismiss: (m: PierreMessage) => act(m, { dismiss: true }),
    snooze: (m: PierreMessage, hours = 24) =>
      act(m, { snoozeUntil: new Date(Date.now() + hours * 3_600_000).toISOString() }),
  };
}
