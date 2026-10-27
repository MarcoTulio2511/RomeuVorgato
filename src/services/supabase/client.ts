import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Só existe conexão se as DUAS variáveis públicas estiverem definidas. Nunca simulamos sucesso sem backend. */
export const isSupabaseConfigured = Boolean(url && key && /^https?:\/\//.test(url));

export class ConfigError extends Error {
  constructor() {
    super(
      'O Supabase não está configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja o README).',
    );
  }
}

let client: SupabaseClient | null = null;

/** Cliente com a chave PÚBLICA (anon/publishable). A service_role jamais é usada no front-end. */
export function getClient(): SupabaseClient {
  if (!isSupabaseConfigured) throw new ConfigError();
  client ??= createClient(url!, key!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  return client;
}

/** Permite trocar o cliente em testes de interface (nunca usado em produção). */
export function __setClientForTests(c: SupabaseClient | null): void {
  client = c;
}
