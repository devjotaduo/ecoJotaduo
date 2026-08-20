# ecoJotaduo

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

## Subindo o ambiente local

```bash
cp docker/.env.example docker/.env && docker compose -f docker/docker-compose.yml up -d
```

O container cria, na primeira subida, o papel restrito `ecojotaduo_app` (é ele que
sofre a Row Level Security — ver [ADR-0007](docs/adr/0007-auth-and-rls-enforcement.md))
e o banco de testes.

```bash
cp .env.example .env                          # configuração da aplicação
pnpm --filter @ecojotaduo/api migrate         # aplica as migrações (como dono)
pnpm --filter @ecojotaduo/api seed:dev        # cria a empresa "demo" e um usuário
pnpm --filter @ecojotaduo/api dev             # sobe em http://127.0.0.1:3000
```

Primeiro login:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/auth/login -H "content-type: application/json" -d '{"email":"admin@demo.local","password":"senha-de-desenvolvimento","tenantSlug":"demo"}'
```

A API escuta em `0.0.0.0` (IPv4, padrão para containers). No Windows, use
`127.0.0.1` em vez de `localhost` se o cliente resolver primeiro para IPv6.

### Testes de integração

Precisam do banco de pé. Copie `.env.test.example` para `.env.test`; sem esse arquivo
as suítes que dependem de banco se declaram **puladas** (nunca passam em silêncio).

## Estrutura

```text
apps/          composition roots (api = REST, mcp-gateway = MCP; worker na Fase 8)
packages/      kernel compartilhado: config, database, auth, permissions,
               tenant-context, audit, platform-kernel, platform-core, http-kit,
               mcp-kit, api-client, tsconfig, eslint-config
modules/       módulos de domínio hexagonais (identity, tenancy, crm)
plugins/       plugins first-party (a partir da Fase 6)
tooling/       apoio a testes e geração de código
docs/          arquitetura, ADRs, API, runbooks
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
