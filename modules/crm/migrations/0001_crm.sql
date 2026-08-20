-- Módulo CRM: clientes, notas e agendamentos.
--
-- Escopo mínimo da Fase 3: cadastro de cliente, notas de relacionamento e
-- agenda de compromissos. Todas as tabelas são de negócio, logo todas têm
-- tenant_id, RLS com `using` + `with check` e grant explícito ao papel da
-- aplicação (ver docs/architecture/tenancy.md).

create table if not exists crm_customers (
  id         uuid        primary key,
  tenant_id  uuid        not null,
  name       text        not null,
  -- Apenas dígitos: a unicidade não pode depender da pontuação digitada.
  document   text,
  email      text,
  phone      text,
  status     text        not null default 'active'
             check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_customers_tenant_document_key unique (tenant_id, document)
);

create index if not exists crm_customers_tenant_name_idx
  on crm_customers (tenant_id, name);

create table if not exists crm_customer_notes (
  id          uuid        primary key,
  tenant_id   uuid        not null,
  customer_id uuid        not null references crm_customers (id) on delete cascade,
  body        text        not null,
  author_id   uuid        not null,
  created_at  timestamptz not null default now()
);

create index if not exists crm_customer_notes_tenant_customer_idx
  on crm_customer_notes (tenant_id, customer_id, created_at desc);

create table if not exists crm_appointments (
  id               uuid        primary key,
  tenant_id        uuid        not null,
  customer_id      uuid        not null references crm_customers (id) on delete cascade,
  title            text        not null,
  scheduled_for    timestamptz not null,
  duration_minutes integer     not null check (duration_minutes between 5 and 480),
  assigned_to_id   uuid,
  status           text        not null default 'scheduled'
                   check (status in ('scheduled', 'done', 'canceled')),
  outcome          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists crm_appointments_tenant_period_idx
  on crm_appointments (tenant_id, scheduled_for);

-- Índice parcial da detecção de conflito: só agendamentos abertos com dono.
create index if not exists crm_appointments_assignee_open_idx
  on crm_appointments (tenant_id, assigned_to_id, scheduled_for)
  where status = 'scheduled' and assigned_to_id is not null;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table crm_customers enable row level security;
drop policy if exists crm_customers_isolation on crm_customers;
create policy crm_customers_isolation on crm_customers
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table crm_customer_notes enable row level security;
drop policy if exists crm_customer_notes_isolation on crm_customer_notes;
create policy crm_customer_notes_isolation on crm_customer_notes
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table crm_appointments enable row level security;
drop policy if exists crm_appointments_isolation on crm_appointments;
create policy crm_appointments_isolation on crm_appointments
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação
-- ---------------------------------------------------------------------------
grant select, insert, update on crm_customers to ecojotaduo_app;
-- Notas são append-only: sem update, sem delete.
grant select, insert on crm_customer_notes to ecojotaduo_app;
grant select, insert, update on crm_appointments to ecojotaduo_app;
