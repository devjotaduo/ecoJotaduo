-- Módulo Contratos: contratos formalizados a partir de propostas aceitas.
--
-- Escopo mínimo da Fase 7: vigência, ativação e encerramento. Todas as tabelas
-- são de negócio, logo todas têm tenant_id, RLS com `using` + `with check` e
-- grant explícito ao papel da aplicação (ver docs/architecture/tenancy.md).

create table if not exists contracts_contracts (
  id           uuid        primary key,
  tenant_id    uuid        not null,
  -- Referências a outros módulos por id, SEM foreign key: cada módulo é dono
  -- das suas tabelas, e uma FK entre módulos travaria a extração futura de
  -- qualquer um deles. A existência é conferida no caso de uso.
  customer_id  uuid        not null,
  proposal_id  uuid        not null,
  number       integer     not null,
  status       text        not null default 'draft'
               check (status in ('draft', 'active', 'finished', 'canceled')),
  title        text        not null,
  currency     char(3)     not null,
  -- Copiado da proposta aceita. Dinheiro é INTEIRO em centavos.
  value_cents  bigint      not null check (value_cents >= 0),
  starts_on    timestamptz not null,
  ends_on      timestamptz not null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  activated_at timestamptz,
  closed_at    timestamptz,
  close_reason text,
  constraint contracts_contracts_term_check check (ends_on > starts_on),
  constraint contracts_contracts_tenant_number_key unique (tenant_id, number),
  -- Uma proposta vira UM contrato só. A regra está no caso de uso; esta
  -- restrição é a rede de baixo, para o caso de duas formalizações
  -- simultâneas passarem pela verificação ao mesmo tempo.
  constraint contracts_contracts_proposal_key unique (tenant_id, proposal_id)
);

create index if not exists contracts_contracts_tenant_customer_idx
  on contracts_contracts (tenant_id, customer_id, created_at desc);

create index if not exists contracts_contracts_tenant_status_idx
  on contracts_contracts (tenant_id, status, ends_on);

-- Contador do número por empresa.
--
-- Tabela própria por módulo, e não um contador compartilhado: tabela usada por
-- dois módulos seria exatamente o "repositório compartilhado global" que o
-- mapa de módulos proíbe. A duplicação do padrão é o preço da fronteira.
create table if not exists contracts_contract_numbers (
  tenant_id   uuid    primary key,
  last_number integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table contracts_contracts enable row level security;
drop policy if exists contracts_contracts_isolation on contracts_contracts;
create policy contracts_contracts_isolation on contracts_contracts
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table contracts_contract_numbers enable row level security;
drop policy if exists contracts_contract_numbers_isolation on contracts_contract_numbers;
create policy contracts_contract_numbers_isolation on contracts_contract_numbers
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação
-- ---------------------------------------------------------------------------
grant select, insert, update on contracts_contracts to ecojotaduo_app;
grant select, insert, update on contracts_contract_numbers to ecojotaduo_app;
