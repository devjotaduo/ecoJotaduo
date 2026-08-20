import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Tabela de plataforma: um usuário pode ter vínculo em vários tenants. */
export const users = pgTable('identity_users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Identidade máquina-a-máquina, presa a um tenant.
 * `tenant_id` propositalmente SEM foreign key: identity não depende de
 * tenancy (a dependência declarada é a inversa). Ver docs/architecture/module-map.md.
 */
export const serviceAccounts = pgTable('identity_service_accounts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  clientId: text('client_id').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const refreshTokens = pgTable('identity_refresh_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  replacedById: uuid('replaced_by_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
