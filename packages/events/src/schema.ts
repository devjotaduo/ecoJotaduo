import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Outbox transacional. Ver `migrations/0001_outbox.sql` para as invariantes. */
export const outbox = pgTable(
  'platform_outbox',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    type: text('type').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    payload: jsonb('payload').notNull().default({}),
    correlationId: uuid('correlation_id'),
    causationId: uuid('causation_id'),
    actorKind: text('actor_kind'),
    actorId: text('actor_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
    /** Handlers que já receberam este evento — o retry não repete quem deu certo. */
    deliveredTo: text('delivered_to').array().notNull().default([]),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (tabela) => [
    index('platform_outbox_tipo_idx').on(
      tabela.tenantId,
      tabela.type,
      tabela.occurredAt,
    ),
  ],
);
