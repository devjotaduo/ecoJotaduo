# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
pnpm install
pnpm lint          # ESLint 10 — inclui as regras de camadas hexagonais
pnpm typecheck
pnpm test          # Vitest em todos os pacotes
pnpm build
pnpm format        # Prettier (format:check no CI)
```

Um único arquivo de teste, ou um teste específico por nome:

```bash
pnpm --filter @ecojotaduo/auth exec vitest run src/access-token.spec.ts
pnpm --filter @ecojotaduo/auth exec vitest run src/access-token.spec.ts -t "alg"
```

Ambiente local (necessário para os testes de integração):

```bash
cp docker/.env.example docker/.env && docker compose -f docker/docker-compose.yml up -d
cp .env.example .env && cp .env.test.example .env.test
pnpm --filter @ecojotaduo/api migrate    # aplica migrações (conecta como dono)
pnpm --filter @ecojotaduo/api seed:dev   # empresa "demo" + admin@demo.local
pnpm --filter @ecojotaduo/api dev        # http://127.0.0.1:3000
```

O init do container só roda com o volume vazio. Se o papel `ecojotaduo_app` ou o banco
`ecojotaduo_test` sumirem, recrie com `docker compose -f docker/docker-compose.yml down -v`
seguido de `up -d`.

## Arquitetura

Monólito modular em monorepo pnpm + Turborepo (ADR-0001). Três camadas de pastas:

- `apps/` — **composition roots**. Cada app monta os mesmos módulos com adaptadores de
  uma borda diferente (`api` = REST; futuramente `mcp-gateway` e `worker`). Toda a
  montagem da API vive em `apps/api/src/bootstrap/composition.ts`.
- `modules/` — domínios de negócio, um pacote pnpm cada, em arquitetura hexagonal.
- `packages/` — kernel compartilhado (config, database, auth, permissions,
  tenant-context, audit, platform-kernel, http-kit).

O CRM (`modules/crm`) é a referência de como um módulo se parece completo:
domínio com invariantes, casos de uso, portas, persistência com RLS, borda REST
**dentro do módulo** e contribuição MCP sobre os mesmos casos de uso.

### Regra de negócio única

REST, MCP, jobs e webhooks **nunca** implementam regra: todos chamam o mesmo caso de
uso em `modules/<x>/src/application/`. Ao adicionar uma capacidade, escreva o caso de
uso primeiro e depois plugue os adaptadores — nunca lógica em controller ou tool MCP.

### Camadas e fronteiras (impostas por lint, não por convenção)

`packages/eslint-config/index.mjs` reprova o build quando:

- `src/domain/**` importa NestJS, Drizzle, HTTP, MCP, Redis, React, **zod**, ou
  qualquer coisa de `application/`, `ports/` ou `adapters/`;
- `src/application/**` importa infraestrutura ou `adapters/` (só fala com `ports/`);
- qualquer arquivo importa `@ecojotaduo/*/src/*` — módulos só enxergam a superfície
  pública (`contracts/`, reexportada pelo `index.ts` do pacote).

Um teste que exercita domínio **e** aplicação vai em `modules/<x>/tests/`, nunca em
`src/domain/` (a regra de camadas reprova o arquivo de teste também).

Comunicação entre módulos: contratos públicos, casos de uso exportados e eventos.
A direção declarada hoje é `tenancy → identity` (por isso "login" vive em tenancy: só
ele conhece vínculo, papéis e módulos contratados).

### Isolamento entre tenants — os dois pontos que quebram tudo se ignorados

1. **A aplicação conecta com um papel PostgreSQL restrito** (`DATABASE_URL` →
   `ecojotaduo_app`), separado do dono das tabelas (`DATABASE_ADMIN_URL`, usado só por
   `migrate` e `seed:dev`). O PostgreSQL **não aplica RLS ao dono nem a superusuários** —
   sem essa separação todas as policies viram decoração. O runner de migrações recusa
   iniciar se o papel não existir.

2. **Nenhuma consulta roda fora de escopo.** Toda leitura/escrita passa por
   `withTenant(db, { tenantId, userId }, …)` ou, nos fluxos pré-tenant (login,
   "minhas empresas"), `withUserOnly(db, userId, …)`. Ambos usam `set_config(..., true)`,
   local à transação. **Sintoma típico de esquecimento: a consulta devolve zero linhas
   em vez de erro** — foi assim que o login quebrou uma vez; a correção é dar escopo à
   consulta, jamais afrouxar a policy.

Toda tabela de negócio nova precisa de `tenant_id NOT NULL`, `enable row level security`,
policy com `using` **e** `with check`, e `grant` explícito para `ecojotaduo_app`
(o papel não herda nada). Use `nullif(current_setting('app.tenant_id', true), '')::uuid`
— o parâmetro pode estar vazio.

### Cadeia de autorização

Uma só, em `apps/api/src/http/access.guard.ts`, aplicada como `APP_GUARD`:

```
token → tenant (claim do token, nunca parâmetro) → vínculo e papéis →
módulo contratado (entitlement) → permissão da rota → caso de uso → auditoria
```

O acesso é resolvido **do banco a cada requisição** — revogar papel ou cancelar módulo
tem efeito imediato. Permissões seguem `modulo.recurso.acao`; o prefixo `platform.*` é
o único isento de entitlement. Rotas usam `@RequirePermissions(...)` ou `@Public()`.
Nunca aceite `tenantId` como parâmetro de rota, body ou tool MCP.

Erros seguem Problem Details (RFC 9457) via `ProblemDetailsFilter`. Falhas de
autenticação são **deliberadamente uniformes** (401 com o mesmo texto para senha
errada, usuário inexistente e empresa inexistente); o motivo real vai só para o log.

Erro de domínio novo deve estender `DomainError` (`@ecojotaduo/platform-kernel`) e
declarar seu `kind` (`invalid-request`, `not-found`, `conflict`, `forbidden`). O
filtro traduz para status HTTP sozinho — **não** adicione `instanceof` novo lá.

### Migrações

SQL escrito à mão, versionado dentro de cada módulo (`modules/<x>/migrations/*.sql`),
aplicado por `packages/database/src/migrator.ts`. A ordem vem da ordenação topológica
dos manifestos (`packages/platform-kernel`), não de configuração manual.

Migrações são **imutáveis**: o ledger guarda checksum e editar um arquivo já aplicado
falha com `MigrationDriftError`. Crie um arquivo novo.

O manifesto de módulo (`src/manifest.ts`) é dado puro — declara `migrations.packageName`,
nunca um caminho de disco; quem resolve o caminho é o composition root.

### Injeção de dependência

**Todo parâmetro de construtor precisa de `@Inject(TOKEN)` explícito** (inclusive
`@Inject(Reflector)`), e providers usam `useFactory` + `inject`. O Vitest transpila com
esbuild, que não emite `design:paramtypes` — injeção por tipo funciona em produção mas
quebra os testes E2E. Tokens ficam em `apps/api/src/bootstrap/tokens.ts`.

## Testes

- Unitários: domínio e aplicação com dublês, sem I/O.
- Integração/E2E: PostgreSQL real, conectando com o papel restrito. Sem `.env.test`
  a suíte se declara **pulada**; com `CI=true` ela **falha** (`exigirBancoEmCI()`), para
  que um pipeline sem banco não fique verde fingindo ter testado o isolamento.
- Suítes de banco compartilham a base e rodam em paralelo sob o turbo: cada uma
  chama `reservarBancoDeTestes()` (advisory lock) no `beforeAll` e libera no `afterAll`.
  Sem isso, o `truncate` de uma apaga os dados da outra.
- Helpers de seed e ambiente ficam em `tooling/test-support` — ele **não** depende de
  nenhum pacote de domínio, para não criar ciclo no grafo do turbo.

## Convenções

- **Idioma**: comentários, documentação, mensagens de erro e de commit em pt-BR.
  Identificadores públicos (classes, interfaces, arquivos, campos de API, permissões,
  eventos) em inglês; variáveis e parâmetros locais em português.
- Comentário explica _por que_, sobretudo quando a escolha protege uma propriedade de
  segurança. Não narre o que o código já diz.
- Datas em UTC; dinheiro como inteiro em centavos + moeda (nunca float); IDs opacos.
- Eventos nomeados no passado e versionados: `crm.customer.created.v1`.
- `TenantId`/`UserId` são tipos marcados (`@ecojotaduo/tenant-context`) — converta com
  `toTenantId()`/`toUserId()`, que validam UUID.

## Automação do projeto (ECC + hooks locais)

O catálogo do ECC está instalado no nível do usuário (`~/.claude`), então agentes,
skills e comandos já valem aqui. O que este repositório versiona em `.claude/` é
só o que o ECC não tem como saber sobre ele.

**Hooks de projeto** (`.claude/settings.json`, `PostToolUse` em `Write|Edit`):

| Hook                        | Bloqueia                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifica-migracao.mjs`     | `create table` sem RLS, sem policy `using`/`with check` ou sem `grant` para `ecojotaduo_app`; e edição de migração já versionada (que causaria `MigrationDriftError`) |
| `verifica-injecao-nest.mjs` | Parâmetro de construtor sem `@Inject(...)` em `apps/api`                                                                                                              |

Ambos saem com código 2 e explicam a correção. Se um deles reclamar de algo
legítimo (ex.: tabela global de propósito), edite a allowlist do hook e registre o
motivo — não desative o hook.

**Agente de projeto**: `tenant-isolation-reviewer` — invoque ao mexer em migração,
persistência, rota autenticada ou tool MCP. Ele cobre só isolamento e autorização;
qualidade e performance de SQL ficam com o `database-reviewer` do ECC.

**Comandos ECC úteis neste repositório**: `/code-review`, `/security-scan`,
`/quality-gate`, `/test-coverage`, `/harness-audit`, `/project-init` (relê o
`ecc-install.json` da raiz, que declara o perfil e as skills do projeto).

**Pré-commit do ECC** (`core.hooksPath` global) bloqueia segredos por regex —
inclusive `token|secret|password|api_key` seguido de string com 12+ caracteres.
Não existe allowlist: quando o achado for falso positivo, **mude o código para não
casar** (constante nomeada em vez de literal, nome de variável psql mais curto),
como já foi feito em `docker/init/01-app-role.sh` e no teste E2E. `ECC_SKIP_PRECOMMIT=1`
é último recurso e exige registrar o motivo na mensagem do commit.

## Antes de mexer

Leia `docs/architecture/roadmap.md` (fase atual, critérios de aceite e dívidas
conhecidas) e os ADRs relevantes em `docs/adr/`. Decisões que mudam tecnologia
principal exigem um ADR novo. Dois pontos fixados que costumam ser revertidos por
engano:

- **Não suba o TypeScript para 7.x** — `typescript-eslint` exige `<6.1.0` e o NestJS
  depende de `emitDecoratorMetadata` (ADR-0006).
- `fastify` está fixado por `pnpm.overrides` na raiz: duas cópias na árvore geram tipos
  incompatíveis entre o adapter do Nest e o app.

Um módulo só está pronto quando entrega um fluxo de negócio completo — tabela + CRUD
não conta. Uma fase só está pronta com lint, typecheck, testes e build executados de
verdade e documentação atualizada.
