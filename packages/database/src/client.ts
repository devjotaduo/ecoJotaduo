import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Database = PostgresJsDatabase<Record<string, never>>;

/** Transação já dentro do escopo de um tenant. */
export type TenantTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface DatabaseHandle {
  readonly db: Database;
  /** Cliente cru — usado por migrações e health check. */
  readonly sql: postgres.Sql;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  readonly url: string;
  readonly maxConnections?: number;
  /** Silencia os NOTICE do PostgreSQL (úteis só durante migrações). */
  readonly quiet?: boolean;
}

export function createDatabase(opcoes: DatabaseOptions): DatabaseHandle {
  const sql = postgres(opcoes.url, {
    max: opcoes.maxConnections ?? 10,
    onnotice: opcoes.quiet ? () => undefined : undefined,
  });

  return {
    db: drizzle({ client: sql }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
