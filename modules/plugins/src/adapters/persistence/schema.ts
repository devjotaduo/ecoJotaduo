import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const pluginInstallations = pgTable(
  'plugin_installations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    version: text('version').notNull(),
    status: text('status').notNull(),
    config: jsonb('config').notNull().default({}),
    grantedPermissions: text('granted_permissions')
      .array()
      .notNull()
      .default([]),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (tabela) => [
    unique('plugin_installations_tenant_plugin_key').on(
      tabela.tenantId,
      tabela.pluginId,
    ),
    index('plugin_installations_tenant_status_idx').on(
      tabela.tenantId,
      tabela.status,
    ),
  ],
);

export const pluginSecrets = pgTable(
  'plugin_secrets',
  {
    tenantId: uuid('tenant_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    key: text('key').notNull(),
    /** Sempre cifrado — ver packages/auth/src/secret-box.ts. */
    sealedValue: text('sealed_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (tabela) => [
    primaryKey({ columns: [tabela.tenantId, tabela.pluginId, tabela.key] }),
  ],
);
