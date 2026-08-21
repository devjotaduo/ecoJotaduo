import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const rentals = pgTable(
  'operations_rentals',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    number: integer('number').notNull(),
    /** Referências a outros módulos por id, sem FK — ver a migração. */
    contractId: uuid('contract_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    assetCode: text('asset_code').notNull(),
    holdId: uuid('hold_id').notNull(),
    status: text('status').notNull().default('scheduled'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    closeReason: text('close_reason'),
  },
  (tabela) => [
    unique('operations_rentals_tenant_number_key').on(
      tabela.tenantId,
      tabela.number,
    ),
    unique('operations_rentals_hold_key').on(tabela.tenantId, tabela.holdId),
    index('operations_rentals_tenant_contract_idx').on(
      tabela.tenantId,
      tabela.contractId,
      tabela.startsAt,
    ),
  ],
);

export const rentalNumbers = pgTable('operations_rental_numbers', {
  tenantId: uuid('tenant_id').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
});
