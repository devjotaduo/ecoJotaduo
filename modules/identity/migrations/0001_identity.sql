-- Módulo identity: usuários, service accounts e refresh tokens.
--
-- Estas são tabelas de PLATAFORMA (não têm escopo de tenant): o login ocorre
-- antes de qualquer tenant ser resolvido e um usuário pode ter vínculo em
-- várias empresas. Nenhum dado de negócio mora aqui — os vínculos e permissões
-- ficam no módulo tenancy, esses sim protegidos por RLS.
--
-- Os grants referenciam o papel de aplicação `movimentar_app`, criado pelo
-- init do container (docker/init) ou pelo DBA em produção.

create table if not exists identity_users (
  id            uuid        primary key,
  email         text        not null unique,
  name          text        not null,
  password_hash text        not null,
  status        text        not null default 'active'
                check (status in ('active', 'suspended', 'disabled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists identity_service_accounts (
  id          uuid        primary key,
  tenant_id   uuid        not null,
  name        text        not null,
  client_id   text        not null unique,
  secret_hash text        not null,
  scopes      text[]      not null default '{}',
  status      text        not null default 'active'
              check (status in ('active', 'disabled')),
  created_at  timestamptz not null default now()
);

create index if not exists identity_service_accounts_tenant_idx
  on identity_service_accounts (tenant_id);

create table if not exists identity_refresh_tokens (
  id             uuid        primary key,
  user_id        uuid        not null references identity_users (id) on delete cascade,
  tenant_id      uuid        not null,
  token_hash     text        not null unique,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  replaced_by_id uuid,
  created_at     timestamptz not null default now()
);

create index if not exists identity_refresh_tokens_user_idx
  on identity_refresh_tokens (user_id) where revoked_at is null;

grant select on identity_users to movimentar_app;
grant select on identity_service_accounts to movimentar_app;
grant select, insert, update on identity_refresh_tokens to movimentar_app;
