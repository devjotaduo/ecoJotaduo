/**
 * Porta de auditoria. Casos de uso dependem apenas deste arquivo — o
 * adaptador PostgreSQL vive em `@ecojotaduo/audit/drizzle`.
 */

export type AuditResult = 'success' | 'denied' | 'error';

export interface AuditEntry {
  /** Ação no formato `modulo.recurso.acao`, ex.: `tenancy.module.granted`. */
  readonly action: string;
  readonly result: AuditResult;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly durationMs?: number;
  /**
   * Contexto adicional da ação. NUNCA inclua segredos, tokens, senhas ou o
   * conteúdo integral de registros — apenas o suficiente para investigar.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditRecord extends AuditEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly actorKind: string;
  readonly actorId: string;
  readonly channel: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
}

export interface AuditQuery {
  readonly action?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface AuditLogger {
  /** Tenant, ator, canal e correlação vêm do contexto — não do chamador. */
  record(entry: AuditEntry): Promise<void>;
  list(query: AuditQuery): Promise<{ items: AuditRecord[]; total: number }>;
}

/** Implementação nula para testes que não exercitam auditoria. */
export class NoopAuditLogger implements AuditLogger {
  readonly entries: AuditEntry[] = [];

  record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }

  list(): Promise<{ items: AuditRecord[]; total: number }> {
    return Promise.resolve({ items: [], total: 0 });
  }
}
