import { useCallback, useRef, useState } from 'react';
import { useToast } from '../components/feedback/Toast';
import { friendlyError } from '../services/supabase/errors';

interface Options<T> {
  successMessage?: string;
  onSuccess?: (result: T) => void | Promise<void>;
}

/**
 * Envio de formulário/ação com: bloqueio de duplo clique, estado de envio, erro amigável e feedback de sucesso.
 *
 * Idempotência: `requestId` é um UUID por tentativa. Ele só muda depois de um sucesso OU se os valores enviados
 * mudaram desde a última tentativa — assim, reenviar após uma falha de rede (que pode ter gravado no servidor)
 * devolve o resultado já gravado em vez de duplicar o lançamento.
 */
export function useSubmit<V, T>(action: (values: V, requestId: string) => Promise<T>, opts: Options<T> = {}) {
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const lastKey = useRef<string | null>(null);

  const submit = useCallback(
    async (values: V): Promise<T | undefined> => {
      if (inFlight.current) return undefined; // clique duplo
      const key = JSON.stringify(values);
      if (lastKey.current !== null && lastKey.current !== key) requestId.current = crypto.randomUUID();
      lastKey.current = key;
      inFlight.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const result = await action(values, requestId.current);
        requestId.current = crypto.randomUUID();
        lastKey.current = null;
        if (opts.successMessage) toast.success(opts.successMessage);
        await opts.onSuccess?.(result);
        return result;
      } catch (e) {
        setError(friendlyError(e));
        return undefined;
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, toast, opts.successMessage, opts.onSuccess],
  );

  return { submit, submitting, error, clearError: () => setError(null) };
}
