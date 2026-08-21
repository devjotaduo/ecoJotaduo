import { AsyncLocalStorage } from 'node:async_hooks';

import type { TenantId } from '@ecojotaduo/tenant-context';

import type { Database, TenantTransaction } from './client';
import { comUnidadeDeTrabalho } from './tenant-scope';

/**
 * Unidade de trabalho: várias escritas, uma transação.
 *
 * Antes desta peça, cada repositório abria a própria transação. Isso funciona
 * para uma escrita só, mas não para "grave o dado E o evento, ou nenhum dos
 * dois" — que é a garantia inteira do padrão outbox. Sem ela, um processo
 * derrubado entre as duas gravações publica um fato que não aconteceu, ou
 * esquece um que aconteceu.
 *
 * A transação ativa viaja por `AsyncLocalStorage`, e não por parâmetro. É
 * escolha deliberada: passar `tx` adiante mudaria a assinatura de todos os
 * repositórios de todos os módulos, e a alternativa mantém `withTenant` com a
 * mesma cara — ele apenas descobre que já está dentro de uma e a reusa.
 */

interface UnidadeAtiva {
  readonly tenantId: string;
  readonly tx: TenantTransaction;
}

const unidade = new AsyncLocalStorage<UnidadeAtiva>();

/**
 * Escrita em nome de outra empresa dentro de uma unidade já aberta.
 *
 * A transação carrega `app.tenant_id` fixado no `set_config`; reusá-la para
 * outro tenant gravaria linhas que a policy `with check` recusaria — ou pior,
 * leria as da empresa errada. Um caso de uso nunca escreve em duas empresas
 * ao mesmo tempo, então isto é defeito, não caso de uso.
 */
export class EscopoCruzadoError extends Error {
  constructor(aberto: string, pedido: string) {
    super(
      `Unidade de trabalho aberta para a empresa ${aberto} recebeu operação da empresa ${pedido}. ` +
        'Uma transação pertence a uma empresa só.',
    );
    this.name = 'EscopoCruzadoError';
  }
}

/**
 * A transação da unidade em curso, quando existe e é da mesma empresa.
 * `undefined` significa "abra a sua" — é o comportamento de sempre.
 */
export function transacaoDaUnidade(
  tenantId: string,
): TenantTransaction | undefined {
  const atual = unidade.getStore();
  if (!atual) {
    return undefined;
  }
  if (atual.tenantId !== tenantId) {
    throw new EscopoCruzadoError(atual.tenantId, tenantId);
  }
  return atual.tx;
}

/** Registra a transação como a unidade em curso enquanto `fn` roda. */
export function comUnidadeAtiva<T>(
  tenantId: string,
  tx: TenantTransaction,
  fn: () => Promise<T>,
): Promise<T> {
  return unidade.run({ tenantId, tx }, fn);
}

/** Já estamos dentro de uma unidade de trabalho? */
export function dentroDeUnidade(): boolean {
  return unidade.getStore() !== undefined;
}

/**
 * Adaptador da porta `UnitOfWork` do kernel sobre a transação do PostgreSQL.
 *
 * Fica aqui, e não no kernel, porque é infraestrutura: o kernel declara o
 * contrato, este arquivo sabe o que é uma transação.
 */
export class DrizzleUnitOfWork {
  constructor(private readonly db: Database) {}

  executar<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return comUnidadeDeTrabalho(
      this.db,
      { tenantId: tenantId as TenantId },
      fn,
    );
  }
}
