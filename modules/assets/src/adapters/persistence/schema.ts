import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const assets = pgTable(
  'assets_assets',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    serialNumber: text('serial_number'),
    acquiredOn: timestamp('acquired_on', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retireReason: text('retire_reason'),
  },
  (tabela) => [
    unique('assets_assets_tenant_code_key').on(tabela.tenantId, tabela.code),
    index('assets_assets_tenant_category_idx').on(
      tabela.tenantId,
      tabela.category,
      tabela.code,
    ),
  ],
);

/**
 * Bloqueios. A restrição que impede sobreposição é de EXCLUSÃO (GiST sobre
 * `tstzrange`) e vive só na migração: o Drizzle não a modela, e ela não muda
 * nada em como se lê ou grava a linha.
 */
export const assetHolds = pgTable(
  'assets_asset_holds',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    reason: text('reason').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (tabela) => [
    index('assets_asset_holds_tenant_asset_idx').on(
      tabela.tenantId,
      tabela.assetId,
      tabela.startsAt,
    ),
  ],
);
