import type { TenantId, UserId } from '@movimentar/tenant-context';
import { sql } from 'drizzle-orm';

import type { Database, TenantTransaction } from './client';

export interface TenantScope {
  readonly tenantId: TenantId;
  /** Necessário para as policies que liberam o próprio vínculo do usuário. */
  readonly userId?: UserId;
}

/**
 * Executa `fn` dentro de uma transação com o tenant fixado na sessão.
 *
 * O `set_config(..., true)` é LOCAL à transação: o valor some no commit ou
 * rollback, então uma conexão devolvida ao pool nunca carrega o tenant da
 * requisição anterior. As policies de RLS leem exatamente estas chaves, de
 * modo que uma consulta que esqueça o `where tenant_id = ...` retorna vazio
 * em vez de dados de outra empresa.
 */
export async function withTenant<T>(
  db: Database,
  escopo: TenantScope,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${escopo.tenantId}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.user_id', ${escopo.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Escopo apenas de usuário, sem tenant fixado. Usado exclusivamente pelos
 * fluxos que são cross-tenant por natureza — listar em quais empresas o
 * usuário tem vínculo. As policies liberam somente as linhas do próprio
 * usuário; nenhum dado de negócio é alcançável por aqui.
 */
export async function withUserOnly<T>(
  db: Database,
  userId: UserId,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
