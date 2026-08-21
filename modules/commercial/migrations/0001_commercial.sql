-- Módulo Comercial: propostas e seus itens.
--
-- Escopo mínimo da Fase 7: proposta para um cliente do CRM, com itens,
-- envio e decisão. Todas as tabelas são de negócio, logo todas têm tenant_id,
-- RLS com `using` + `with check` e grant explícito ao papel da aplicação
-- (ver docs/architecture/tenancy.md).

create table if not exists commercial_proposals (
  id          uuid        primary key,
  tenant_id   uuid        not null,
  -- Referência ao CRM por id, SEM foreign key: cada módulo é dono das suas
  -- tabelas, e uma FK entre módulos travaria a extração futura de qualquer um
  -- deles. A existência do cliente é conferida no caso de uso.
  customer_id uuid        not null,
  -- Número sequencial POR EMPRESA: é como as pessoas se referem à proposta.
  number      integer     not null,
  status      text        not null default 'draft'
              check (status in ('draft', 'sent', 'accepted', 'rejected')),
  -- ISO 4217. Uma proposta tem uma moeda só.
  currency    char(3)     not null,
  title       text        not null,
  notes       text,
  valid_until timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz,
  decided_at  timestamptz,
  constraint commercial_proposals_tenant_number_key unique (tenant_id, number)
);

create index if not exists commercial_proposals_tenant_customer_idx
  on commercial_proposals (tenant_id, customer_id, created_at desc);

create index if not exists commercial_proposals_tenant_status_idx
  on commercial_proposals (tenant_id, status, valid_until);

create table if not exists commercial_proposal_items (
  id               uuid        primary key,
  tenant_id        uuid        not null,
  proposal_id      uuid        not null references commercial_proposals (id) on delete cascade,
  position         integer     not null,
  description      text        not null,
  quantity         integer     not null check (quantity >= 1),
  -- Dinheiro é INTEIRO em centavos. Float aqui vira diferença de fechamento.
  unit_price_cents bigint      not null check (unit_price_cents >= 0),
  discount_cents   bigint      not null default 0 check (discount_cents >= 0),
  constraint commercial_proposal_items_order_key unique (proposal_id, position)
);

create index if not exists commercial_proposal_items_tenant_proposal_idx
  on commercial_proposal_items (tenant_id, proposal_id, position);

-- Contador do número por empresa.
--
-- Tabela própria, e não `max(number) + 1`, porque duas propostas criadas ao
-- mesmo tempo leriam o mesmo máximo e disputariam o mesmo número. Aqui o
-- `on conflict do update ... returning` incrementa e trava a linha num único
-- comando: a segunda transação espera e recebe o número seguinte.
create table if not exists commercial_proposal_numbers (
  tenant_id   uuid    primary key,
  last_number integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table commercial_proposals enable row level security;
drop policy if exists commercial_proposals_isolation on commercial_proposals;
create policy commercial_proposals_isolation on commercial_proposals
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table commercial_proposal_items enable row level security;
drop policy if exists commercial_proposal_items_isolation on commercial_proposal_items;
create policy commercial_proposal_items_isolation on commercial_proposal_items
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table commercial_proposal_numbers enable row level security;
drop policy if exists commercial_proposal_numbers_isolation on commercial_proposal_numbers;
create policy commercial_proposal_numbers_isolation on commercial_proposal_numbers
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação
-- ---------------------------------------------------------------------------
grant select, insert, update on commercial_proposals to ecojotaduo_app;
-- Itens são substituídos em bloco enquanto a proposta é rascunho.
grant select, insert, delete on commercial_proposal_items to ecojotaduo_app;
grant select, insert, update on commercial_proposal_numbers to ecojotaduo_app;
