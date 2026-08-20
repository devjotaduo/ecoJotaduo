-- Trilha de auditoria da plataforma.
-- Escopo de tenant com RLS: `using` filtra a leitura e `with check` impede
-- gravar evento em nome de outro tenant.

create table if not exists audit_events (
  id             uuid        primary key,
  tenant_id      uuid        not null,
  actor_kind     text        not null,
  actor_id       text        not null,
  channel        text        not null,
  action         text        not null,
  result         text        not null,
  resource_type  text,
  resource_id    text,
  duration_ms    integer,
  correlation_id uuid        not null,
  metadata       jsonb,
  occurred_at    timestamptz not null default now()
);

create index if not exists audit_events_tenant_occurred_idx
  on audit_events (tenant_id, occurred_at desc);

create index if not exists audit_events_correlation_idx
  on audit_events (correlation_id);

alter table audit_events enable row level security;

drop policy if exists audit_events_tenant_isolation on audit_events;
create policy audit_events_tenant_isolation on audit_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- A aplicação nunca altera nem apaga auditoria: trilha é append-only.
grant select, insert on audit_events to movimentar_app;
