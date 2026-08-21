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

export const proposals = pgTable(
  'commercial_proposals',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    /** Referência ao CRM por id, sem FK — ver a migração. */
    customerId: uuid('customer_id').notNull(),
    number: integer('number').notNull(),
    status: text('status').notNull().default('draft'),
    currency: char('currency', { length: 3 }).notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (tabela) => [
    unique('commercial_proposals_tenant_number_key').on(
      tabela.tenantId,
      tabela.number,
    ),
    index('commercial_proposals_tenant_customer_idx').on(
      tabela.tenantId,
      tabela.customerId,
      tabela.createdAt,
    ),
  ],
);

export const proposalItems = pgTable(
  'commercial_proposal_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    /**
     * `bigint` com `mode: 'number'`: centavos cabem com folga em número
     * seguro do JavaScript (até ~90 trilhões de reais) e o domínio já recusa
     * qualquer coisa que não seja inteiro seguro.
     */
    unitPriceCents: bigint('unit_price_cents', { mode: 'number' }).notNull(),
    discountCents: bigint('discount_cents', { mode: 'number' })
      .notNull()
      .default(0),
  },
  (tabela) => [
    unique('commercial_proposal_items_order_key').on(
      tabela.proposalId,
      tabela.position,
    ),
    index('commercial_proposal_items_tenant_proposal_idx').on(
      tabela.tenantId,
      tabela.proposalId,
      tabela.position,
    ),
  ],
);

export const proposalNumbers = pgTable('commercial_proposal_numbers', {
  tenantId: uuid('tenant_id').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
});
