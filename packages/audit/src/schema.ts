import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    channel: text('channel').notNull(),
    action: text('action').notNull(),
    result: text('result').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    durationMs: integer('duration_ms'),
    correlationId: uuid('correlation_id').notNull(),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (tabela) => [
    index('audit_events_tenant_occurred_idx').on(
      tabela.tenantId,
      tabela.occurredAt,
    ),
  ],
);
