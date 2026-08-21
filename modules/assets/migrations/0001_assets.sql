-- Módulo Ativos: equipamentos da empresa e os bloqueios que os tiram de circulação.
--
-- Escopo mínimo da Fase 7: cadastro, bloqueio por período, liberação e baixa.
-- Todas as tabelas são de negócio, logo todas têm tenant_id, RLS com `using` +
-- `with check` e grant explícito ao papel da aplicação (docs/architecture/tenancy.md).

-- `btree_gist` permite combinar igualdade (uuid) com sobreposição (range) num
-- mesmo índice GiST — é o que torna possível a restrição de exclusão lá
-- embaixo. Extensão "trusted" desde o PostgreSQL 13: o dono do banco cria sem
-- ser superusuário, que é exatamente como o runner de migrações conecta.
create extension if not exists btree_gist;

create table if not exists assets_assets (
  id            uuid        primary key,
  tenant_id     uuid        not null,
  -- Identificação de patrimônio. Dois ativos com o mesmo código tornam
  -- impossível dizer qual saiu para o cliente.
  code          text        not null,
  name          text        not null,
  category      text        not null,
  serial_number text,
  acquired_on   timestamptz,
  -- Só o que é FATO sobre o ativo. "Disponível" não é coluna: sai dos
  -- bloqueios abaixo, no instante em que se pergunta.
  status        text        not null default 'active'
                check (status in ('active', 'retired')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  retired_at    timestamptz,
  retire_reason text,
  constraint assets_assets_tenant_code_key unique (tenant_id, code)
);

create index if not exists assets_assets_tenant_category_idx
  on assets_assets (tenant_id, category, code);

create table if not exists assets_asset_holds (
  id          uuid        primary key,
  tenant_id   uuid        not null,
  -- Referência dentro do próprio módulo: aqui a FK é legítima (o mesmo dono
  -- é responsável pelas duas tabelas), e garante que bloqueio órfão não exista.
  asset_id    uuid        not null references assets_assets (id) on delete cascade,
  reason      text        not null
              check (reason in ('maintenance', 'reserved', 'damaged', 'transit')),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  -- Liberação antecipada: encurta o período efetivo, sem apagar o combinado.
  released_at timestamptz,
  notes       text,
  created_at  timestamptz not null default now(),
  constraint assets_asset_holds_period_check check (ends_at > starts_at),
  -- O CORAÇÃO DESTE MÓDULO.
  --
  -- Dois bloqueios sobre o mesmo ativo não podem cobrir o mesmo instante. O
  -- caso de uso já verifica antes de gravar, mas verificação em aplicação tem
  -- janela: duas reservas simultâneas leem "livre" e as duas gravam — e o
  -- conflito só aparece no dia da entrega, com dois clientes esperando o
  -- mesmo equipamento. É a mesma corrida de `max(number) + 1` que a numeração
  -- de propostas evita com contador atômico.
  --
  -- O período que conta é o EFETIVO (encurtado pela liberação). `greatest`
  -- protege o caso de liberar antes do início: o intervalo vira vazio, e
  -- intervalo vazio não sobrepõe nada — o bloqueio some da disputa sem sumir
  -- do histórico.
  --
  -- Borda `[)`: um bloqueio que termina às 12h e outro que começa às 12h não
  -- conflitam. Com os dois lados fechados, todo encadeamento normal de
  -- operações viraria erro.
  constraint assets_asset_holds_no_overlap exclude using gist (
    tenant_id with =,
    asset_id with =,
    tstzrange(starts_at, greatest(starts_at, coalesce(released_at, ends_at)), '[)') with &&
  )
);

create index if not exists assets_asset_holds_tenant_asset_idx
  on assets_asset_holds (tenant_id, asset_id, starts_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table assets_assets enable row level security;
drop policy if exists assets_assets_isolation on assets_assets;
create policy assets_assets_isolation on assets_assets
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table assets_asset_holds enable row level security;
drop policy if exists assets_asset_holds_isolation on assets_asset_holds;
create policy assets_asset_holds_isolation on assets_asset_holds
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Privilégios do papel da aplicação
-- ---------------------------------------------------------------------------
grant select, insert, update on assets_assets to ecojotaduo_app;
grant select, insert, update on assets_asset_holds to ecojotaduo_app;
