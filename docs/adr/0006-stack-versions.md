# ADR-0006 — Stack tecnológica e versões fixadas

- **Status**: aceito
- **Data**: 2026-08-20 (versões verificadas nesta data via `npm view <pkg> version` no registro npm)

## Problema

O prompt do projeto define a stack conceitual (NestJS, Fastify, Drizzle, pnpm,
Turborepo, MCP SDK, React/Vite). É preciso fixar versões estáveis reais, compatíveis
entre si, e registrar por que algumas "latest" foram deliberadamente evitadas.

## Decisão — versões adotadas

### Runtime e workspace

| Ferramenta | Versão | Observação |
|---|---|---|
| Node.js | 24.x (local: 24.13.0) | LTS atual; `engines >= 24` |
| pnpm | 10.28.2 | fixado em `packageManager` |
| Turborepo | 2.10.11 | `turbo.json` com `tasks` (formato v2) |
| TypeScript | **5.9.3** | ver "decisão relevante" abaixo |

### Backend (em uso a partir da Fase 1)

| Pacote | Versão |
|---|---|
| @nestjs/core / common / platform-fastify | 11.2.1 |
| fastify (transitivo do adapter) | 5.12.1 |
| reflect-metadata | 0.2.2 |
| rxjs | 7.8.2 |
| zod | 4.4.3 |

### Qualidade

| Pacote | Versão |
|---|---|
| ESLint | 10.8.1 |
| typescript-eslint | 8.67.0 (peer: eslint ^8.57 ‖ ^9 ‖ ^10; typescript >=4.8.4 <6.1.0) |
| @eslint/js | 10.0.1 |
| Prettier | 3.9.6 |
| Vitest | 4.1.11 |

### Planejados para fases seguintes (versões verificadas na mesma data)

| Pacote | Versão | Fase |
|---|---|---|
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.10 | 2–3 |
| @nestjs/swagger | 11.4.7 | 3–4 |
| @modelcontextprotocol/sdk | 1.30.0 | 5 |
| react / react-dom | 19.2.8 | 3 |
| vite | 8.2.2 | 3 |
| tailwindcss | 4.3.3 | 3 |
| bullmq | 6.1.2 | 8 |
| postgres (driver) | 3.4.9 | 2–3 |

### Infraestrutura (imagens Docker)

| Imagem | Tag |
|---|---|
| PostgreSQL | `postgres:18-alpine` |
| Redis | `redis:8-alpine` |

## Decisão relevante: TypeScript 5.9.x, não 7.x

A `latest` do TypeScript hoje é **7.0.2** (compilador nativo). Ela foi deliberadamente
evitada porque:

1. `typescript-eslint` 8.67.0 declara peer `typescript <6.1.0` — a cadeia de lint
   não suporta a linha 7.
2. O NestJS depende de `emitDecoratorMetadata` para injeção de dependência por tipo,
   recurso do compilador clássico cuja paridade na linha nova ainda não é garantida
   pelo ecossistema Nest.

Reavaliar quando typescript-eslint e NestJS declararem suporte oficial à linha ≥7.

## Benefícios

- Conjunto verificado de compatibilidade (peers checados no registro, não de memória).
- Reprodutibilidade: `packageManager` + lockfile + engines fixam o ambiente.

## Riscos

- Vite 8 / Vitest 4 / ESLint 10 são majors recentes; plugins do ecossistema podem
  atrasar. Mitigação: majors só entram com peer ranges conferidos (como feito aqui).

## Impacto da migração

Upgrades de major passam por PR dedicado com changelog lido e CI verde; este ADR é
atualizado a cada mudança de versão relevante.
