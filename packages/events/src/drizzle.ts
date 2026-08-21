import { randomUUID } from 'node:crypto';

import type { Database } from '@ecojotaduo/database';
import { withTenant } from '@ecojotaduo/database';
import { requireAuth, requireContext } from '@ecojotaduo/tenant-context';
import { and, asc, eq, lte, sql } from 'drizzle-orm';

import type {
  EventoParaPublicar,
  EventPublisher,
  IntegrationEvent,
} from './index';
import { outbox } from './schema';

export { outbox } from './schema';

type LinhaDoOutbox = typeof outbox.$inferSelect;

/**
 * Grava o evento no outbox, dentro do escopo do tenant.
 *
 * Quando o caso de uso roda numa unidade de trabalho, o `withTenant` daqui
 * reusa a transação já aberta — e é só por isso que o evento e o dado que o
 * originou têm o mesmo destino: os dois vão, ou nenhum vai.
 */
export class DrizzleEventPublisher implements EventPublisher {
  constructor(private readonly db: Database) {}

  async publish(evento: EventoParaPublicar): Promise<void> {
    const contexto = requireContext();
    const auth = requireAuth();

    await withTenant(
      this.db,
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        await tx.insert(outbox).values({
          id: randomUUID(),
          tenantId: auth.tenantId,
          type: evento.type,
          resourceType: evento.resourceType ?? null,
          resourceId: evento.resourceId ?? null,
          payload: evento.payload ?? {},
          correlationId: contexto.correlationId,
          causationId: null,
          actorKind: auth.actor.kind,
          actorId: auth.actor.id,
          occurredAt: new Date(),
          status: 'pending',
          attempts: 0,
          availableAt: new Date(),
          deliveredTo: [],
        });
      },
    );
  }
}

/** Leitura e atualização do outbox, usadas só pelo dispatcher. */
export class DrizzleOutbox {
  constructor(private readonly db: Database) {}

  /**
   * Empresas com evento pendente já elegível.
   *
   * Passa pela função `security definer` da migração: é o único ponto que
   * enxerga além de uma empresa, e ele devolve apenas identificadores — nunca
   * conteúdo. Daqui em diante tudo roda sob `withTenant`, com a RLS valendo.
   */
  async tenantsComPendencia(limite = 100): Promise<string[]> {
    const linhas = await this.db.execute<{ tenant_id: string }>(
      sql`select platform_outbox_pending_tenants(${limite}) as tenant_id`,
    );
    return [...linhas].map((linha) => linha.tenant_id).filter(Boolean);
  }

  /**
   * Reserva um lote de eventos pendentes da empresa.
   *
   * `for update skip locked` deixa vários workers dividirem a fila sem
   * combinar nada: quem pega uma linha a segura até o fim da transação, e os
   * outros simplesmente pulam.
   */
  async lote(tenantId: string, tamanho: number): Promise<IntegrationEvent[]> {
    return withTenant(
      this.db,
      { tenantId: comoTenant(tenantId) },
      async (tx) => {
        const linhas = await tx
          .select()
          .from(outbox)
          .where(
            and(
              eq(outbox.tenantId, tenantId),
              eq(outbox.status, 'pending'),
              lte(outbox.availableAt, new Date()),
            ),
          )
          .orderBy(asc(outbox.availableAt), asc(outbox.occurredAt))
          .limit(tamanho)
          .for('update', { skipLocked: true });

        return linhas.map(paraEvento);
      },
    );
  }

  /** Quais handlers já receberam este evento. */
  async entreguesA(tenantId: string, eventId: string): Promise<string[]> {
    return withTenant(
      this.db,
      { tenantId: comoTenant(tenantId) },
      async (tx) => {
        const [linha] = await tx
          .select({ deliveredTo: outbox.deliveredTo })
          .from(outbox)
          .where(and(eq(outbox.tenantId, tenantId), eq(outbox.id, eventId)))
          .limit(1);
        return linha?.deliveredTo ?? [];
      },
    );
  }

  /** Marca que um handler recebeu o evento — sem fechá-lo ainda. */
  async registrarEntrega(
    tenantId: string,
    eventId: string,
    handler: string,
  ): Promise<void> {
    await withTenant(
      this.db,
      { tenantId: comoTenant(tenantId) },
      async (tx) => {
        // `array_append` no próprio UPDATE: ler-modificar-gravar perderia a
        // entrega de um worker concorrente.
        await tx
          .update(outbox)
          .set({
            deliveredTo: sql`array_append(${outbox.deliveredTo}, ${handler})`,
          })
          .where(
            and(
              eq(outbox.tenantId, tenantId),
              eq(outbox.id, eventId),
              sql`not (${handler} = any(${outbox.deliveredTo}))`,
            ),
          );
      },
    );
  }

  async concluir(tenantId: string, eventId: string): Promise<void> {
    await withTenant(
      this.db,
      { tenantId: comoTenant(tenantId) },
      async (tx) => {
        await tx
          .update(outbox)
          .set({
            status: 'delivered',
            deliveredAt: new Date(),
            lastError: null,
          })
          .where(and(eq(outbox.tenantId, tenantId), eq(outbox.id, eventId)));
      },
    );
  }

  /**
   * Falhou: adia a próxima tentativa, ou desiste.
   *
   * O adiamento é a fila: em vez de um agendador à parte, a própria linha diz
   * quando volta a ser elegível.
   */
  async adiar(entrada: {
    tenantId: string;
    eventId: string;
    tentativas: number;
    erro: string;
    proximaEm: Date | null;
  }): Promise<void> {
    await withTenant(
      this.db,
      { tenantId: comoTenant(entrada.tenantId) },
      async (tx) => {
        await tx
          .update(outbox)
          .set(
            entrada.proximaEm
              ? {
                  attempts: entrada.tentativas,
                  availableAt: entrada.proximaEm,
                  lastError: entrada.erro.slice(0, 2000),
                }
              : {
                  attempts: entrada.tentativas,
                  status: 'dead',
                  lastError: entrada.erro.slice(0, 2000),
                },
          )
          .where(
            and(
              eq(outbox.tenantId, entrada.tenantId),
              eq(outbox.id, entrada.eventId),
            ),
          );
      },
    );
  }

  /** Devolve um evento morto para a fila. É o replay da DLQ. */
  async reviver(tenantId: string, eventId: string): Promise<boolean> {
    return withTenant(
      this.db,
      { tenantId: comoTenant(tenantId) },
      async (tx) => {
        const linhas = await tx
          .update(outbox)
          .set({
            status: 'pending',
            attempts: 0,
            availableAt: new Date(),
            lastError: null,
          })
          .where(
            and(
              eq(outbox.tenantId, tenantId),
              eq(outbox.id, eventId),
              eq(outbox.status, 'dead'),
            ),
          )
          .returning({ id: outbox.id });
        return linhas.length > 0;
      },
    );
  }
}

/**
 * O tipo marcado exige `toTenantId`, que valida UUID. Aqui o valor já veio do
 * banco, então a validação seria só custo — mas o cast fica isolado neste
 * ponto, e não espalhado pelas consultas.
 */
function comoTenant(tenantId: string) {
  return tenantId as Parameters<typeof withTenant>[1]['tenantId'];
}

function paraEvento(linha: LinhaDoOutbox): IntegrationEvent {
  return {
    id: linha.id,
    tenantId: linha.tenantId,
    type: linha.type,
    resourceType: linha.resourceType ?? undefined,
    resourceId: linha.resourceId ?? undefined,
    payload: (linha.payload ?? {}) as Record<string, unknown>,
    occurredAt: linha.occurredAt,
    correlationId: linha.correlationId,
    causationId: linha.causationId,
    actorKind: linha.actorKind,
    actorId: linha.actorId,
    attempts: linha.attempts,
  };
}
