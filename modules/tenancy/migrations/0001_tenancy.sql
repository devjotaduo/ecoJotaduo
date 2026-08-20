-- Módulo tenancy: organizações, tenants, vínculos, papéis e contratação.
--
-- Aqui mora o isolamento entre empresas. Toda tabela com escopo de tenant
-- carrega `tenant_id` e tem Row Level Security ligada, lendo os parâmetros
-- `app.tenant_id` / `app.user_id` que a aplicação define por transação
-- (ver packages/database/src/tenant-scope.ts).
--
-- IMPORTANTE: a RLS não se aplica ao dono da tabela nem a superusuários. Por
-- isso a aplicação conecta com o papel `movimentar_app`, que só recebe os
-- grants abaixo.

create table if not exists tenancy_organizations (
  id         uuid        primary key,
  name       text        not null,
  created_at timestamptz not null default now()
);

create table if not exists tenancy_tenants (
  id              uuid        primary key,
  organization_id uuid        not null references tenancy_organizations (id),
  slug            text        not null unique,
  name            text        not null,
  status          text        not null default 'active'
                  check (status in ('active', 'suspended', 'archived')),
  created_at      timestamptz not null default now()
);

create table if not exists tenancy_memberships (
  id         uuid        primary key,
  tenant_id  uuid        not null references tenancy_tenants (id) on delete cascade,
  user_id    uuid        not null references identity_users (id) on delete cascade,
  status     text        not null default 'active'
             check (status in ('active', 'invited', 'revoked')),
  created_at timestamptz not null default now(),
  constraint tenancy_memberships_tenant_user_key unique (tenant_id, user_id)
);

create index if not exists tenancy_memberships_user_idx
  on tenancy_memberships (user_id);

-- tenant_id nulo identifica papel de sistema (disponível a todos os tenants).
create table if not exists tenancy_roles (
  id        uuid primary key,
  tenant_id uuid references tenancy_tenants (id) on delete cascade,
  key       text not null,
  name      text not null
);

create unique index if not exists tenancy_roles_system_key_idx
  on tenancy_roles (key) where tenant_id is null;
create unique index if not exists tenancy_roles_tenant_key_idx
  on tenancy_roles (tenant_id, key) where tenant_id is not null;

create table if not exists tenancy_role_permissions (
  role_id    uuid not null references tenancy_roles (id) on delete cascade,
  tenant_id  uuid,
  permission text not null,
  primary key (role_id, permission)
);

create table if not exists tenancy_membership_roles (
  membership_id uuid not null references tenancy_memberships (id) on delete cascade,
  role_id       uuid not null references tenancy_roles (id) on delete cascade,
  tenant_id     uuid not null references tenancy_tenants (id) on delete cascade,
  primary key (membership_id, role_id)
);

create table if not exists tenancy_module_entitlements (
  id         uuid        primary key,
  tenant_id  uuid        not null references tenancy_tenants (id) on delete cascade,
  module_id  text        not null,
  status     text        not null default 'active'
             check (status in ('active', 'suspended')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint tenancy_module_entitlements_tenant_module_key unique (tenant_id, module_id)
);

-- ---------------------------------------------------------------------------
-- Papéis de sistema (ids fixos para a migração ser idempotente)
-- ---------------------------------------------------------------------------
insert into tenancy_roles (id, tenant_id, key, name) values
  ('00000000-0000-4000-8000-000000000001', null, 'owner',  'Proprietário'),
  ('00000000-0000-4000-8000-000000000002', null, 'admin',  'Administrador'),
  ('00000000-0000-4000-8000-000000000003', null, 'member', 'Membro')
on conflict (id) do nothing;

insert into tenancy_role_permissions (role_id, tenant_id, permission) values
  ('00000000-0000-4000-8000-000000000001', null, '*'),
  ('00000000-0000-4000-8000-000000000002', null, 'platform.*')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- Tenants: enxerga-se o tenant da sessão e aqueles em que o usuário tem
-- vínculo (necessário para a tela "escolha a empresa" antes do login pleno).
alter table tenancy_tenants enable row level security;
drop policy if exists tenancy_tenants_visibility on tenancy_tenants;
create policy tenancy_tenants_visibility on tenancy_tenants
  using (
    id = nullif(current_setting('app.tenant_id', true), '')::uuid
    or id in (
      select m.tenant_id from tenancy_memberships m
      where m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );

-- Vínculos: os do tenant corrente, mais os do próprio usuário.
alter table tenancy_memberships enable row level security;
drop policy if exists tenancy_memberships_visibility on tenancy_memberships;
create policy tenancy_memberships_visibility on tenancy_memberships
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    or user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

-- Papéis: de sistema (tenant_id nulo) ou do tenant corrente.
alter table tenancy_roles enable row level security;
drop policy if exists tenancy_roles_visibility on tenancy_roles;
create policy tenancy_roles_visibility on tenancy_roles
  using (
    tenant_id is null
    or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

alter table tenancy_role_permissions enable row level security;
drop policy if exists tenancy_role_permissions_visibility on tenancy_role_permissions;
create policy tenancy_role_permissions_visibility on tenancy_role_permissions
  using (
    tenant_id is null
    or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

alter table tenancy_membership_roles enable row level security;
drop policy if exists tenancy_membership_roles_isolation on tenancy_membership_roles;
create policy tenancy_membership_roles_isolation on tenancy_membership_roles
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table tenancy_module_entitlements enable row level security;
drop policy if exists tenancy_module_entitlements_isolation on tenancy_module_entitlements;
create policy tenancy_module_entitlements_isolation on tenancy_module_entitlements
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação (sem DDL, sem DELETE em dado histórico)
-- ---------------------------------------------------------------------------
grant select on tenancy_organizations to movimentar_app;
grant select on tenancy_tenants to movimentar_app;
grant select on tenancy_memberships to movimentar_app;
grant select on tenancy_roles to movimentar_app;
grant select on tenancy_role_permissions to movimentar_app;
grant select on tenancy_membership_roles to movimentar_app;
grant select, insert, update, delete on tenancy_module_entitlements to movimentar_app;
