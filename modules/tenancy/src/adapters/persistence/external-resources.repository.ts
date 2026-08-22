import { withTenant, type Database } from '@ecojotaduo/database';
import type { TenantId } from '@ecojotaduo/tenant-context';
import { and, asc, eq } from 'drizzle-orm';
import {
  ExternalResource,
  type DadosDoRecursoExterno,
  type EstadoDoRecurso,
  type SistemaExterno,
  type TipoDeRecurso,
} from '../../domain/external-resource';
import type { ExternalResourceRepository } from '../../ports/external-resources.repository';
import { externalResources } from './schema';

type Linha = typeof externalResources.$inferSelect;

export class DrizzleExternalResourceRepository
  implements ExternalResourceRepository
{
  constructor(private readonly db: Database) {}

  async achar(
    tenantId: TenantId,
    system: SistemaExterno,
    kind: TipoDeRecurso,
  ): Promise<ExternalResource | null> {
    return withTenant(this.db, { tenantId }, async (tx) => {
      const [linha] = await tx
        .select()
        .from(externalResources)
        .where(
          and(
            eq(externalResources.system, system),
            eq(externalResources.kind, kind),
          ),
        )
        .limit(1);
      return linha ? this.paraDominio(linha) : null;
    });
  }

  async listar(tenantId: TenantId): Promise<ExternalResource[]> {
    return withTenant(this.db, { tenantId }, async (tx) => {
      const linhas = await tx
        .select()
        .from(externalResources)
        .orderBy(asc(externalResources.system), asc(externalResources.kind));
      return linhas.map((linha) => this.paraDominio(linha));
    });
  }

  async salvar(recurso: ExternalResource): Promise<void> {
    const dados = recurso.paraPersistencia();
    await withTenant(this.db, { tenantId: dados.tenantId }, async (tx) => {
      await tx
        .insert(externalResources)
        .values({
          id: dados.id,
          tenantId: dados.tenantId,
          system: dados.system,
          kind: dados.kind,
          // Persistimos o valor CRU, e não o getter: o getter esconde o
          // identificador fora do estado `active` para quem lê o domínio, mas
          // apagá-lo do banco perderia o rastro de qual recurso foi revogado.
          externalId: dados.externalId,
          state: dados.state,
          failureReason: dados.failureReason,
          createdAt: dados.createdAt,
          updatedAt: dados.updatedAt,
        })
        // A chave natural é (empresa, sistema, tipo) — registrar de novo é
        // atualizar, não duplicar. É o que torna o provisionamento idempotente
        // sem o chamador precisar perguntar antes.
        .onConflictDoUpdate({
          target: [
            externalResources.tenantId,
            externalResources.system,
            externalResources.kind,
          ],
          set: {
            externalId: dados.externalId,
            state: dados.state,
            failureReason: dados.failureReason,
            updatedAt: dados.updatedAt,
          },
        });
    });
  }

  private paraDominio(linha: Linha): ExternalResource {
    const dados: DadosDoRecursoExterno = {
      id: linha.id,
      tenantId: linha.tenantId as TenantId,
      system: linha.system as SistemaExterno,
      kind: linha.kind as TipoDeRecurso,
      externalId: linha.externalId,
      state: linha.state as EstadoDoRecurso,
      failureReason: linha.failureReason,
      createdAt: linha.createdAt,
      updatedAt: linha.updatedAt,
    };
    return ExternalResource.de(dados);
  }
}
