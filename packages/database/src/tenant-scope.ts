import type { TenantId, UserId } from '@ecojotaduo/tenant-context';
import { sql } from 'drizzle-orm';

import type { Database, TenantTransaction } from './client';
import { comUnidadeAtiva, transacaoDaUnidade } from './unit-of-work';

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
  // Dentro de uma unidade de trabalho, reusa a transação já aberta: é isso
  // que permite gravar o dado e o evento de forma atômica, sem que nenhum
  // repositório precise receber `tx` por parâmetro. Fora dela, nada muda —
  // cada chamada continua abrindo a sua.
  const daUnidade = await transacaoDaUnidade(escopo.tenantId, escopo.userId);
  if (daUnidade) {
    return fn(daUnidade);
  }
  return abrirTransacaoDoTenant(db, escopo, fn);
}

/**
 * Uma transação, várias escritas: tudo o que rodar dentro de `fn` — inclusive
 * `withTenant` chamado por repositórios lá no fundo — compartilha a mesma
 * transação e o mesmo commit.
 */
export async function comUnidadeDeTrabalho<T>(
  db: Database,
  escopo: TenantScope,
  fn: () => Promise<T>,
): Promise<T> {
  // Já dentro de uma: participa da que existe, em vez de abrir outra. Sem
  // isto, um caso de uso que chama outro perderia a atomicidade em silêncio.
  const daUnidade = await transacaoDaUnidade(escopo.tenantId, escopo.userId);
  if (daUnidade) {
    return fn();
  }
  return abrirTransacaoDoTenant(db, escopo, (tx) =>
    comUnidadeAtiva(escopo, tx, fn),
  );
}

function abrirTransacaoDoTenant<T>(
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
