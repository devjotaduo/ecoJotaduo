-- Registry de plugins: instalação por empresa e segredos de integração.
--
-- Toda linha aqui pertence a UMA empresa. Se o isolamento falhar, uma empresa
-- passa a ver (ou usar) a credencial de integração de outra — por isso as duas
-- tabelas têm tenant_id, RLS com `using` + `with check` e grant explícito ao
-- papel da aplicação (ver docs/architecture/tenancy.md).

create table if not exists plugin_installations (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  -- Id do plugin no catálogo da instalação (não é FK: o catálogo é código).
  plugin_id           text        not null,
  version             text        not null,
  status              text        not null
                      check (status in ('installed', 'configured', 'enabled', 'disabled')),
  -- Configuração NÃO sensível. O que é segredo vai cifrado na outra tabela.
  config              jsonb       not null default '{}'::jsonb,
  -- Subconjunto do que o manifesto pede, concedido por quem instalou.
  granted_permissions text[]      not null default '{}',
  installed_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint plugin_installations_tenant_plugin_key unique (tenant_id, plugin_id)
);

create index if not exists plugin_installations_tenant_status_idx
  on plugin_installations (tenant_id, status);

create table if not exists plugin_secrets (
  tenant_id    uuid        not null,
  plugin_id    text        not null,
  key          text        not null,
  -- Sempre cifrado (AES-256-GCM, packages/auth/src/secret-box.ts). Valor em
  -- claro nunca toca esta coluna, nem em desenvolvimento.
  sealed_value text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, plugin_id, key)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table plugin_installations enable row level security;
drop policy if exists plugin_installations_isolation on plugin_installations;
create policy plugin_installations_isolation on plugin_installations
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table plugin_secrets enable row level security;
drop policy if exists plugin_secrets_isolation on plugin_secrets;
create policy plugin_secrets_isolation on plugin_secrets
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on plugin_installations to ecojotaduo_app;
-- Delete é necessário: desinstalar apaga os segredos da empresa junto.
grant select, insert, update, delete on plugin_secrets to ecojotaduo_app;
