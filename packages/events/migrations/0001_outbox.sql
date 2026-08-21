-- Outbox transacional da plataforma.
--
-- O evento é gravado na MESMA transação do dado que o originou. Sem isso, um
-- processo derrubado entre as duas gravações publica um fato que não aconteceu
-- (evento sem dado) ou esquece um que aconteceu (dado sem evento) — e as duas
-- falhas são silenciosas.

create table if not exists platform_outbox (
  id             uuid        primary key,
  tenant_id      uuid        not null,
  -- Nome versionado do fato, no passado: `crm.customer.created.v1`.
  type           text        not null,
  resource_type  text,
  resource_id    text,
  payload        jsonb       not null default '{}'::jsonb,
  -- Rastreio: de qual requisição veio, e qual evento causou este.
  correlation_id uuid,
  causation_id   uuid,
  actor_kind     text,
  actor_id       text,
  occurred_at    timestamptz not null default now(),

  -- Entrega
  status         text        not null default 'pending'
                 check (status in ('pending', 'delivered', 'dead')),
  attempts       integer     not null default 0,
  -- Quando este evento volta a ser elegível. É o backoff: em vez de uma fila
  -- separada com agendamento, a própria linha diz quando tentar de novo.
  available_at   timestamptz not null default now(),
  -- Handlers que JÁ receberam este evento. Um retry não repete quem deu certo:
  -- sem isto, dois handlers e uma falha em um deles reexecutariam os dois.
  delivered_to   text[]      not null default '{}',
  delivered_at   timestamptz,
  last_error     text,
  created_at     timestamptz not null default now()
);

-- Sustenta a varredura do dispatcher: pendentes já elegíveis, mais antigos
-- primeiro.
create index if not exists platform_outbox_pendentes_idx
  on platform_outbox (tenant_id, available_at)
  where status = 'pending';

create index if not exists platform_outbox_tipo_idx
  on platform_outbox (tenant_id, type, occurred_at desc);

create index if not exists platform_outbox_correlacao_idx
  on platform_outbox (correlation_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table platform_outbox enable row level security;
drop policy if exists platform_outbox_isolation on platform_outbox;
create policy platform_outbox_isolation on platform_outbox
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Como o dispatcher descobre onde há trabalho
-- ---------------------------------------------------------------------------
-- O worker precisa varrer TODAS as empresas, e a RLS — corretamente — não
-- deixa. As saídas ruins seriam conectar como dono (a RLS deixaria de valer
-- para tudo) ou afrouxar a policy acima (o isolamento viraria decoração).
--
-- A saída boa é esta função: roda com o privilégio do DONO (`security
-- definer`), mas devolve exclusivamente o `tenant_id` de quem tem evento
-- pendente. Nenhum payload, nenhum tipo, nenhuma contagem — só "há trabalho
-- aqui". O dispatcher então entra em cada empresa por `withTenant`, e daí para
-- frente a RLS vale integralmente, como para qualquer outra consulta.
--
-- `search_path` fixo é obrigatório em `security definer`: sem ele, quem
-- pudesse criar um schema à frente do `public` sequestraria a resolução de
-- nomes dentro de uma função que roda como dono.
create or replace function platform_outbox_pending_tenants(limite integer default 100)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select distinct tenant_id
  from platform_outbox
  where status = 'pending' and available_at <= now()
  limit limite;
$$;

revoke all on function platform_outbox_pending_tenants(integer) from public;

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação
-- ---------------------------------------------------------------------------
-- Sem `delete`: evento entregue ou morto continua no outbox como histórico do
-- que a plataforma publicou. A limpeza é rotina de retenção, não do caminho
-- quente.
grant select, insert, update on platform_outbox to ecojotaduo_app;
grant execute on function platform_outbox_pending_tenants(integer) to ecojotaduo_app;
