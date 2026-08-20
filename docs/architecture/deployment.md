# Visão de implantação

## Ambiente de desenvolvimento

`docker/docker-compose.yml` sobe PostgreSQL 18 e Redis 8 com health checks; apps
rodam localmente via pnpm. Variáveis validadas por schema no boot (falha cedo).

## Produção inicial (MVP): uma VM com Docker Compose

```mermaid
flowchart TB
    DNS["DNS + TLS"] --> PROXY["Reverse proxy (Caddy)"]

    subgraph VM["VM única (Docker Compose)"]
        PROXY --> API1["api (réplicas N)"]
        PROXY --> MCP1["mcp-gateway (réplicas N)"]
        WORKERS["worker (réplicas N)"]
        PG[("PostgreSQL 18<br/>volume + backup")]
        REDIS[("Redis 8")]
    end

    STORAGE["Object storage S3-compatível (externo)"]
    OBSBACK["Backend OTel (externo)"]

    API1 --> PG
    API1 --> REDIS
    MCP1 --> PG
    MCP1 --> REDIS
    WORKERS --> PG
    WORKERS --> REDIS
    WORKERS --> STORAGE
    API1 --> OBSBACK
    MCP1 --> OBSBACK
    WORKERS --> OBSBACK
```

## Evolução (Kubernetes-ready, Fase 11)

```mermaid
flowchart TB
    LB["Load Balancer"]
    LB --> APIA["API Replica 1..N"]
    LB --> MCPA["MCP Replica 1..N"]
    WORKERS2["Workers (HPA por fila)"]
    PG2[("PostgreSQL gerenciado")]
    REDIS2[("Redis gerenciado")]
    PLUGINS["Plugin containers isolados"]

    APIA --> PG2
    APIA --> REDIS2
    MCPA --> PG2
    MCPA --> REDIS2
    WORKERS2 --> PG2
    WORKERS2 --> REDIS2
    WORKERS2 --> PLUGINS
```

## Princípios (desde a Fase 1)

- **Stateless**: API e MCP sem estado em memória entre requests (workflows usam ids
  persistidos) — escala horizontal trivial.
- **12-factor**: config por ambiente via env validada; mesma imagem para todos os
  ambientes.
- **Migrations controladas**: passo explícito de deploy, nunca automático no boot de
  réplica.
- **Health/readiness** por app; **graceful shutdown** (drenar conexões/jobs).
- **Deploy independente** de api, mcp-gateway e worker (imagens distintas do mesmo
  monorepo).
- **Backup** diário do Postgres + teste de restore periódico (runbook na Fase 10/11).
- **Zero-downtime**: rolling por réplica atrás do proxy; migrations
  backward-compatible (expand/contract).
