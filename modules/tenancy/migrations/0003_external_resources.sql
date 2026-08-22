-- Recursos que existem FORA desta plataforma e pertencem a uma empresa daqui.
--
-- É o vocabulário da Fase 13 (ADR-0017): hoje uma empresa do ecossistema
-- JotaDuo não é uma linha em lugar nenhum — ela é a coincidência de cinco
-- coisas em cinco sistemas, amarradas por convenção de nome. Esta tabela é o
-- lugar onde `tenant_id` vira o identificador de cada um deles.
--
-- Mora em tenancy, e não num módulo próprio, porque uma tabela com CRUD não é
-- módulo (docs/architecture/roadmap.md). Vira módulo na sub-fase 4, quando
-- `provisioning_runs` e os adaptadores trouxerem um fluxo completo — e aí a
-- extração é o padrão já provado do ADR-0016.

create table if not exists tenancy_external_resources (
  id              uuid        primary key,
  -- Sem chave estrangeira para `tenancy_tenants`, apesar de estarem no mesmo
  -- módulo hoje: esta tabela sai daqui na sub-fase 4, e FK é exatamente o que
  -- trava extração (ADR-0016). O preço é que o `truncate` de tenants não
  -- alcança esta tabela em cascata — por isso ela entra explicitamente na
  -- limpeza entre testes de `tooling/test-support`.
  tenant_id       uuid        not null,
  -- O sistema de destino. Lista fechada de propósito: valor livre aqui
  -- viraria `omniroute`/`omni-route`/`OmniRoute` na mesma coluna, e a
  -- pergunta "esta empresa está inteira?" deixaria de ter resposta.
  system          text        not null
                  check (system in ('studio', 'omniroute', 'hermes', 'crm', 'whatsapp')),
  kind            text        not null
                  check (kind in ('group', 'service-account', 'api-key',
                                  'profile', 'workspace', 'owner-slot', 'public-slot')),
  -- O identificador NO SISTEMA DE DESTINO. Nulo enquanto o recurso não existe
  -- lá — é o que distingue "pedimos" de "existe".
  external_id     text,
  state           text        not null default 'pending'
                  check (state in ('pending', 'active', 'failed', 'revoked')),
  -- Só existe para explicar `failed`. Sem ela, um recurso falho é
  -- indistinguível de um recurso esquecido, e ninguém investiga o que não
  -- tem motivo escrito.
  failure_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Um recurso por (empresa, sistema, tipo). É isto que torna o registro
  -- consultável: "o grupo do Studio da empresa X" tem UMA resposta. Sistema
  -- que precise de dois do mesmo tipo declara um `kind` novo (foi o caso dos
  -- dois slots do WhatsApp), em vez de duplicar a linha.
  constraint tenancy_external_resources_unico unique (tenant_id, system, kind),

  -- Ativo sem identificador externo é mentira: o registro diria que o recurso
  -- existe lá fora sem saber apontar qual. Foi exatamente esse tipo de estado
  -- não-nomeável que o provisionamento por script deixava para trás.
  constraint tenancy_external_resources_ativo_tem_id
    check (state <> 'active' or external_id is not null),
  constraint tenancy_external_resources_falha_tem_motivo
    check (state <> 'failed' or failure_reason is not null)
);

create index if not exists tenancy_external_resources_tenant_idx
  on tenancy_external_resources (tenant_id, system, kind);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table tenancy_external_resources enable row level security;
drop policy if exists tenancy_external_resources_isolation on tenancy_external_resources;
create policy tenancy_external_resources_isolation on tenancy_external_resources
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação
-- ---------------------------------------------------------------------------
-- Sem `delete`: recurso externo não some do registro. Revogar é estado, não
-- ausência — apagar a linha perderia a única evidência de que aquele grupo,
-- chave ou workspace um dia existiu e a quem pertencia.
grant select, insert, update on tenancy_external_resources to ecojotaduo_app;
