import {
  bigint,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const contracts = pgTable(
  'contracts_contracts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    /** Referências a outros módulos por id, sem FK — ver a migração. */
    customerId: uuid('customer_id').notNull(),
    proposalId: uuid('proposal_id').notNull(),
    number: integer('number').notNull(),
    status: text('status').notNull().default('draft'),
    title: text('title').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    valueCents: bigint('value_cents', { mode: 'number' }).notNull(),
    startsOn: timestamp('starts_on', { withTimezone: true }).notNull(),
    endsOn: timestamp('ends_on', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason'),
  },
  (tabela) => [
    unique('contracts_contracts_tenant_number_key').on(
      tabela.tenantId,
      tabela.number,
    ),
    unique('contracts_contracts_proposal_key').on(
      tabela.tenantId,
      tabela.proposalId,
    ),
    index('contracts_contracts_tenant_customer_idx').on(
      tabela.tenantId,
      tabela.customerId,
      tabela.createdAt,
    ),
  ],
);

export const contractNumbers = pgTable('contracts_contract_numbers', {
  tenantId: uuid('tenant_id').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
});
