import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const customers = pgTable(
  'crm_customers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    /** Só dígitos; nulo quando o cliente ainda não informou. */
    document: text('document'),
    email: text('email'),
    phone: text('phone'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (tabela) => [
    unique('crm_customers_tenant_document_key').on(
      tabela.tenantId,
      tabela.document,
    ),
    index('crm_customers_tenant_name_idx').on(tabela.tenantId, tabela.name),
  ],
);

export const customerNotes = pgTable(
  'crm_customer_notes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    authorId: uuid('author_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (tabela) => [
    index('crm_customer_notes_tenant_customer_idx').on(
      tabela.tenantId,
      tabela.customerId,
      tabela.createdAt,
    ),
  ],
);

export const appointments = pgTable(
  'crm_appointments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    assignedToId: uuid('assigned_to_id'),
    status: text('status').notNull().default('scheduled'),
    outcome: text('outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (tabela) => [
    index('crm_appointments_tenant_period_idx').on(
      tabela.tenantId,
      tabela.scheduledFor,
    ),
  ],
);
