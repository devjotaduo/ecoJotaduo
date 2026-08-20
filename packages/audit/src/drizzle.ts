import { randomUUID } from 'node:crypto';

import type { Database } from '@ecojotaduo/database';
import { withTenant } from '@ecojotaduo/database';
import { requireAuth, requireContext } from '@ecojotaduo/tenant-context';
import { and, count, desc, eq } from 'drizzle-orm';

import type { AuditEntry, AuditLogger, AuditQuery, AuditRecord } from './index';
import { auditEvents } from './schema';

export { auditEvents } from './schema';

const LIMITE_MAXIMO = 200;

/**
 * Escreve a trilha no PostgreSQL dentro do escopo do tenant. A policy de RLS
 * tem `with check` no tenant, então nem um bug de código consegue gravar
 * auditoria na conta de outra empresa.
 */
export class DrizzleAuditLogger implements AuditLogger {
  constructor(private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    const contexto = requireContext();
    const auth = requireAuth();

    await withTenant(
      this.db,
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        await tx.insert(auditEvents).values({
          id: randomUUID(),
          tenantId: auth.tenantId,
          actorKind: auth.actor.kind,
          actorId: auth.actor.id,
          channel: contexto.channel,
          action: entry.action,
          result: entry.result,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          durationMs: entry.durationMs ?? null,
          correlationId: contexto.correlationId,
          metadata: entry.metadata ?? null,
          occurredAt: new Date(),
        });
      },
    );
  }

  async list(
    query: AuditQuery,
  ): Promise<{ items: AuditRecord[]; total: number }> {
    const auth = requireAuth();
    const limite = Math.min(Math.max(query.limit, 1), LIMITE_MAXIMO);

    return withTenant(
      this.db,
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        // O filtro por tenant é redundante com a RLS — de propósito: defesa em
        // profundidade e uso do índice (tenant_id, occurred_at).
        const filtro = query.action
          ? and(
              eq(auditEvents.tenantId, auth.tenantId),
              eq(auditEvents.action, query.action),
            )
          : eq(auditEvents.tenantId, auth.tenantId);

        const linhas = await tx
          .select()
          .from(auditEvents)
          .where(filtro)
          .orderBy(desc(auditEvents.occurredAt))
          .limit(limite)
          .offset(Math.max(query.offset, 0));

        const [total] = await tx
          .select({ valor: count() })
          .from(auditEvents)
          .where(filtro);

        return {
          items: linhas.map((linha) => ({
            id: linha.id,
            tenantId: linha.tenantId,
            actorKind: linha.actorKind,
            actorId: linha.actorId,
            channel: linha.channel,
            action: linha.action,
            result: linha.result as AuditRecord['result'],
            resourceType: linha.resourceType ?? undefined,
            resourceId: linha.resourceId ?? undefined,
            durationMs: linha.durationMs ?? undefined,
            correlationId: linha.correlationId,
            metadata:
              (linha.metadata as Record<string, unknown> | null) ?? undefined,
            occurredAt: linha.occurredAt,
          })),
          total: total?.valor ?? 0,
        };
      },
    );
  }
}
