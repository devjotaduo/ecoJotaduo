# Visão C4 — Nível 2: Containers

```mermaid
flowchart TB
    subgraph CLIENTS["Clientes e aplicações"]
        WEB["ERP Web<br/>React + Vite"]
        ADMIN["Administração da plataforma"]
        MOBILE["Mobile (futuro)"]
        SITE["Site público (opcional, Next.js)"]
        EXTERNAL["Aplicações externas"]
        AIHOST["Hosts e agentes de IA"]
    end

    subgraph ENTRY["Camadas de entrada"]
        API["apps/api<br/>NestJS + Fastify<br/>REST + OpenAPI"]
        MCP["apps/mcp-gateway<br/>MCP TypeScript SDK<br/>Streamable HTTP"]
        WORKER["apps/worker<br/>BullMQ + outbox dispatcher"]
        WEBHOOKS["Webhooks (entrada assinada)"]
    end

    subgraph CORE["Core da plataforma (pacotes compartilhados)"]
        AUTH["auth + tenant-context + permissions"]
        USECASES["Casos de uso dos módulos"]
        MODULES["modules/* (hexagonal)"]
        REGISTRY["platform-kernel<br/>Module & Plugin Registry"]
        EVENTS["event-bus + outbox"]
    end

    subgraph DATA["Dados e infraestrutura"]
        POSTGRES[("PostgreSQL 18")]
        OBS["Log estruturado + trilha de auditoria"]
    end

    subgraph PLUGINS["Extensões"]
        BUILTIN["Módulos internos"]
        FIRSTPARTY["Plugins first-party"]
        REMOTE["Plugins externos<br/>(container isolado)"]
        UPSTREAMMCP["Servidores MCP externos"]
    end

    WEB --> API
    ADMIN --> API
    MOBILE --> API
    SITE --> API
    EXTERNAL --> API
    EXTERNAL --> WEBHOOKS
    AIHOST --> MCP

    API --> AUTH
    MCP --> AUTH
    WORKER --> AUTH
    WEBHOOKS --> AUTH

    API --> USECASES
    MCP --> USECASES
    WORKER --> USECASES
    WEBHOOKS --> USECASES

    USECASES --> MODULES
    MODULES --> POSTGRES
    MODULES --> EVENTS
    EVENTS --> WORKER

    REGISTRY --> BUILTIN
    REGISTRY --> FIRSTPARTY
    REGISTRY --> REMOTE
    REGISTRY --> UPSTREAMMCP

    API --> OBS
    MCP --> OBS
    WORKER --> OBS
```

## Containers e responsabilidades

| Container           | Responsabilidade                                                 | Escala                                 |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `apps/api`          | REST versionada, OpenAPI, autenticação, webhooks de entrada      | Horizontal (stateless)                 |
| `apps/mcp-gateway`  | Descoberta e execução de tools/resources/prompts MCP             | Horizontal (stateless)                 |
| `apps/worker`       | Outbox dispatcher, jobs BullMQ, handlers de eventos, integrações | Horizontal (competing consumers)       |
| `apps/web`          | SPA interna (React + Vite) consumindo o SDK gerado               | CDN/estático                           |
| `apps/plugin-admin` | Gestão de módulos/plugins por tenant (fase 6)                    | —                                      |
| `apps/site`         | Páginas públicas/SEO (opcional, Next.js)                         | —                                      |
| PostgreSQL          | Fonte de verdade, RLS, outbox                                    | Vertical + réplicas de leitura futuras |
| Redis               | Cache segmentado por tenant, filas BullMQ                        | Gerenciado                             |

Os três processos backend são **composition roots** distintos dos mesmos módulos —
inicializações diferentes, regra de negócio única.

## Sequência crítica — fluxo REST

```mermaid
sequenceDiagram
    participant Web as Web/SDK
    participant API as apps/api
    participant Ctx as Auth + TenantContext
    participant UC as CreateCustomerUseCase
    participant DB as PostgreSQL

    Web->>API: POST /api/v1/customers (JWT)
    API->>Ctx: autentica, resolve tenant, entitlement, política
    Ctx-->>API: RequestContext { user, tenant, permissions }
    API->>UC: execute(dto, ctx)
    UC->>DB: INSERT customer (tenant_id) + outbox(crm.customer.created.v1)
    DB-->>UC: ok (mesma transação)
    UC-->>API: CustomerDto
    API-->>Web: 201 + Location
```

## Sequência crítica — fluxo MCP

```mermaid
sequenceDiagram
    participant Host as Host de IA
    participant GW as apps/mcp-gateway
    participant Ctx as Auth + TenantContext
    participant Reg as MCP Registry
    participant UC as CreateCustomerUseCase

    Host->>GW: tools/list
    GW->>Ctx: autentica token, resolve tenant + entitlements
    GW->>Reg: filtra catálogo por tenant/escopos
    Reg-->>Host: somente tools permitidas
    Host->>GW: tools/call crm.customer.create
    GW->>Ctx: revalida escopo + política + entrada (schema)
    GW->>UC: execute(dto, ctx)  %% MESMO caso de uso do REST
    UC-->>GW: resultado estruturado
    GW-->>Host: content + structuredContent (+ auditoria)
```
