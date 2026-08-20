# Movimentar Platform

ERP modular multi-tenant: backend NestJS + Fastify com contrato OpenAPI, gateway MCP
para agentes de IA, workers assíncronos e plataforma de plugins — construído como
**monólito modular** com extração seletiva futura.

A arquitetura completa vive em [`docs/architecture`](docs/architecture) e as decisões
em [`docs/adr`](docs/adr). Comece por
[system-context](docs/architecture/system-context.md) e
[roadmap](docs/architecture/roadmap.md).

## Stack

Node 24 · pnpm 10 · Turborepo 2 · TypeScript 5.9 · NestJS 11 (Fastify) · Zod 4 ·
Vitest 4 · ESLint 10 · PostgreSQL 18 · Redis 8 — versões fixadas no
[ADR-0006](docs/adr/0006-stack-versions.md).

## Comandos

```bash
pnpm install     # instalar dependências
pnpm lint        # lint (regras de camadas incluídas)
pnpm typecheck   # verificação de tipos
pnpm test        # testes (Vitest)
pnpm build       # build de todos os pacotes
pnpm format      # formatar com Prettier
```

Infraestrutura local (PostgreSQL + Redis) — credenciais ficam em `docker/.env`,
fora do git:

```bash
cp docker/.env.example docker/.env && docker compose -f docker/docker-compose.yml up -d
```

API em desenvolvimento:

```bash
pnpm --filter @movimentar/api dev   # compila e sobe http://127.0.0.1:3000/health
```

A API escuta em `0.0.0.0` (IPv4, padrão para containers). No Windows, use
`127.0.0.1` em vez de `localhost` se o navegador/cliente resolver primeiro para
IPv6. A porta vem da env `PORT` (ver `.env.example`).

## Estrutura

```text
apps/          composition roots (api; futuramente web, mcp-gateway, worker, …)
packages/      kernel compartilhado (tsconfig, eslint-config, config, …)
modules/       módulos de domínio hexagonais (a partir da Fase 3)
plugins/       plugins first-party (a partir da Fase 6)
docs/          arquitetura, ADRs, runbooks
docker/        infraestrutura local
```

Diretórios de fases futuras só são criados quando a fase chega — sem esqueletos
vazios. O mapa completo planejado está em
[module-map](docs/architecture/module-map.md).

## Regras de ouro

1. Regra de negócio única: REST, MCP, jobs e webhooks chamam os mesmos casos de uso.
2. Módulo não importa `src/**` de outro módulo — apenas `contracts/`.
3. Nenhuma consulta sem tenant; segurança sempre server-side.
4. Eventos no passado e versionados (`crm.customer.created.v1`).
5. Fase pronta = lint + typecheck + testes + build verdes e docs atualizados.
