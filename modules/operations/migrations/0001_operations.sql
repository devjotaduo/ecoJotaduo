-- Módulo Operações: locações de equipamento sob contrato.
--
-- Escopo mínimo da Fase 7: programar, iniciar, devolver e cancelar. Todas as
-- tabelas são de negócio, logo todas têm tenant_id, RLS com `using` +
-- `with check` e grant explícito ao papel da aplicação (docs/architecture/tenancy.md).

create table if not exists operations_rentals (
  id            uuid        primary key,
  tenant_id     uuid        not null,
  number        integer     not null,
  -- Referências a outros módulos por id, SEM foreign key: cada módulo é dono
  -- das suas tabelas, e uma FK entre módulos travaria a extração futura de
  -- qualquer um deles. A existência é conferida no caso de uso, contra a
  -- superfície pública do módulo dono.
  contract_id   uuid        not null,
  customer_id   uuid        not null,
  asset_id      uuid        not null,
  -- Copiado do patrimônio no momento da programação, para a listagem não
  -- precisar de uma ida ao módulo Ativos por linha.
  asset_code    text        not null,
  -- A reserva criada em Ativos. É ELA que impede duas locações do mesmo
  -- equipamento no mesmo período: a restrição de exclusão vive lá, sobre a
  -- tabela de bloqueios. Aqui não há nada a duplicar.
  hold_id       uuid        not null,
  status        text        not null default 'scheduled'
                check (status in ('scheduled', 'active', 'finished', 'canceled')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  canceled_at   timestamptz,
  close_reason  text,
  constraint operations_rentals_period_check check (ends_at > starts_at),
  constraint operations_rentals_tenant_number_key unique (tenant_id, number),
  -- Uma reserva serve a UMA locação. Se duas locações apontassem para o mesmo
  -- bloqueio, devolver uma delas soltaria o equipamento que a outra ainda usa.
  constraint operations_rentals_hold_key unique (tenant_id, hold_id)
);

create index if not exists operations_rentals_tenant_contract_idx
  on operations_rentals (tenant_id, contract_id, starts_at desc);

create index if not exists operations_rentals_tenant_asset_idx
  on operations_rentals (tenant_id, asset_id, starts_at desc);

-- Sustenta a consulta de locações atrasadas: em andamento com prazo vencido.
create index if not exists operations_rentals_tenant_status_idx
  on operations_rentals (tenant_id, status, ends_at);

-- Contador do número por empresa. Tabela própria por módulo, e não um contador
-- compartilhado: tabela usada por dois módulos seria exatamente o "repositório
-- compartilhado global" que o mapa de módulos proíbe.
create table if not exists operations_rental_numbers (
  tenant_id   uuid    primary key,
  last_number integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table operations_rentals enable row level security;
drop policy if exists operations_rentals_isolation on operations_rentals;
create policy operations_rentals_isolation on operations_rentals
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table operations_rental_numbers enable row level security;
drop policy if exists operations_rental_numbers_isolation on operations_rental_numbers;
create policy operations_rental_numbers_isolation on operations_rental_numbers
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação
-- ---------------------------------------------------------------------------
grant select, insert, update on operations_rentals to ecojotaduo_app;
grant select, insert, update on operations_rental_numbers to ecojotaduo_app;
