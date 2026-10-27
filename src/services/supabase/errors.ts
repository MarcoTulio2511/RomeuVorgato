export class AppError extends Error {
  constructor(
    message: string,
    readonly kind: 'validation' | 'permission' | 'conflict' | 'session' | 'network' | 'unknown' = 'unknown',
  ) {
    super(message);
  }
}

type PgLike = { message?: string; code?: string; details?: string; status?: number };

const OWN_MESSAGE_CODES = new Set(['P0001', 'P0002', '22023', '22007', '23514']);

const sessionListeners = new Set<() => void>();
/** A AuthProvider se inscreve para encerrar a sessão quando o servidor recusar o token. */
export function onSessionExpired(cb: () => void): () => void {
  sessionListeners.add(cb);
  return () => sessionListeners.delete(cb);
}
export function notifySessionExpired(): void {
  sessionListeners.forEach((cb) => cb());
}

function isSessionError(e: PgLike): boolean {
  return (
    e.code === '28000' ||
    e.code === 'PGRST301' ||
    e.code === 'PGRST303' ||
    /jwt (expired|invalid)|invalid jwt|Sessão expirada/i.test(e.message ?? '')
  );
}

/**
 * Converte qualquer erro em mensagem amigável SEM expor detalhes técnicos (SQL, nomes de tabela/política).
 * Mensagens levantadas pelas nossas RPCs (códigos P0001/P0002/22023/22007) já estão em português e são mantidas.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const e = (error ?? {}) as PgLike;
  const msg = e.message ?? '';
  if (error instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)) {
    return new AppError('Sem conexão com o servidor. Verifique a internet e tente novamente.', 'network');
  }
  if (isSessionError(e)) {
    notifySessionExpired();
    return new AppError('Sua sessão expirou. Entre novamente.', 'session');
  }
  if (
    /row-level security|permission denied/i.test(msg) ||
    (e.code === '42501' && !OWN_MESSAGE_CODES.has('42501') && /rls|policy/i.test(msg))
  ) {
    return new AppError('Você não tem permissão para esta ação.', 'permission');
  }
  if (e.code === '42501' && msg) return new AppError(msg, 'permission');
  if (e.code === '23505') return new AppError('Já existe um registro igual a este.', 'conflict');
  if (e.code === '23503')
    return new AppError(
      'Este item está em uso por outros dados e não pode ser removido. Considere desativá-lo.',
      'conflict',
    );
  if (e.code && OWN_MESSAGE_CODES.has(e.code) && msg) return new AppError(msg, 'validation');
  if (e.code === '23514' || e.code === '23502' || e.code === '22P02') {
    return new AppError('Alguns dados informados não são válidos. Revise e tente novamente.', 'validation');
  }
  if (msg && /invalid login credentials/i.test(msg))
    return new AppError('E-mail ou senha incorretos.', 'validation');
  if (msg && /user already registered/i.test(msg))
    return new AppError('Este e-mail já está cadastrado.', 'conflict');
  if (msg && /password should be at least/i.test(msg))
    return new AppError('A senha deve ter pelo menos 8 caracteres.', 'validation');
  if (msg && /email not confirmed/i.test(msg))
    return new AppError('Confirme seu e-mail antes de entrar (veja sua caixa de entrada).', 'validation');
  if (msg && /rate limit|too many/i.test(msg))
    return new AppError('Muitas tentativas. Aguarde um instante e tente de novo.', 'validation');
  // detalhe técnico só no console de desenvolvimento, nunca na tela
  if (import.meta.env?.DEV) console.error('[erro não mapeado]', error);
  return new AppError('Algo deu errado. Tente novamente em instantes.', 'unknown');
}

export function friendlyError(error: unknown): string {
  return toAppError(error).message;
}
