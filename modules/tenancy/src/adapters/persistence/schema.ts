import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable('tenancy_organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tenants = pgTable('tenancy_tenants', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  'tenancy_memberships',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** FK para identity_users: tenancy declara dependência de identity. */
    userId: uuid('user_id').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (tabela) => [
    unique('tenancy_memberships_tenant_user_key').on(
      tabela.tenantId,
      tabela.userId,
    ),
  ],
);

/** `tenant_id` nulo = papel de sistema, disponível para todos os tenants. */
export const roles = pgTable('tenancy_roles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, {
    onDelete: 'cascade',
  }),
  key: text('key').notNull(),
  name: text('name').notNull(),
});

export const rolePermissions = pgTable(
  'tenancy_role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    /** Denormalizado a partir do papel para permitir a policy de RLS. */
    tenantId: uuid('tenant_id'),
    permission: text('permission').notNull(),
  },
  (tabela) => [primaryKey({ columns: [tabela.roleId, tabela.permission] })],
);

export const membershipRoles = pgTable(
  'tenancy_membership_roles',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
  },
  (tabela) => [primaryKey({ columns: [tabela.membershipId, tabela.roleId] })],
);

export const moduleEntitlements = pgTable(
  'tenancy_module_entitlements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    moduleId: text('module_id').notNull(),
    status: text('status').notNull().default('active'),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (tabela) => [
    unique('tenancy_module_entitlements_tenant_module_key').on(
      tabela.tenantId,
      tabela.moduleId,
    ),
  ],
);
