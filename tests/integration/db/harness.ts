import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Executa as migrations REAIS (supabase/migrations) num Postgres em WASM (PGlite),
 * com um "shim" mínimo do schema `auth` do Supabase. Permite testar constraints, RPCs e RLS
 * sem credenciais. Não substitui os testes contra um projeto Supabase real (tests/rls).
 */
const AUTH_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

export async function createDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(AUTH_SHIM);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    try {
      await pg.exec(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      throw new Error(`Falha na migration ${file}: ${(e as Error).message}`, { cause: e });
    }
  }
  return new Db(pg);
}

export type Row = Record<string, unknown>;

export class Db {
  constructor(readonly pg: PGlite) {}

  /** Execução como superusuário (setup/inspeção; ignora RLS). */
  async admin<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.pg.exec('reset role');
    return (await this.pg.query<T>(sql, params)).rows;
  }

  async addUser(email: string): Promise<string> {
    const r = await this.admin<{ id: string }>('insert into auth.users (email) values ($1) returning id', [
      email,
    ]);
    return r[0]!.id;
  }

  /** Executa como o usuário autenticado (RLS ativa). `userId = null` => anon. */
  as(userId: string | null): UserSession {
    return new UserSession(this.pg, userId);
  }
}

export class UserSession {
  constructor(
    private readonly pg: PGlite,
    private readonly userId: string | null,
  ) {}

  private async enter(): Promise<void> {
    await this.pg.exec('reset role');
    await this.pg.query("select set_config('request.jwt.claim.sub', $1, false)", [this.userId ?? '']);
    await this.pg.exec(this.userId ? 'set role authenticated' : 'set role anon');
  }

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.enter();
    try {
      return (await this.pg.query<T>(sql, params)).rows;
    } finally {
      await this.pg.exec('reset role');
    }
  }

  /** Chama uma RPC pelo nome, com parâmetros posicionais. */
  async rpc<T = Row>(fn: string, ...args: unknown[]): Promise<T> {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.query<Record<string, T>>(`select public.${fn}(${ph}) as r`, args);
    return rows[0]!['r'] as T;
  }

  /** Espera falha e devolve a mensagem de erro. */
  async fails(sql: string, params: unknown[] = []): Promise<string> {
    try {
      await this.query(sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`Esperava erro, mas passou: ${sql}`);
  }

  async rpcFails(fn: string, ...args: unknown[]): Promise<string> {
    try {
      await this.rpc(fn, ...args);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`Esperava erro em ${fn}, mas passou`);
  }
}
