# Roadmap de implementação

Fases estritamente ordenadas; cada fase termina com lint + typecheck + testes + build
executados de verdade, documentação atualizada e riscos declarados. Nenhum módulo é
"pronto" com apenas tabela e CRUD.

| Fase                                      | Objetivo                              | Entregáveis-chave                                                                                                                                                          | Critério de aceite                                                                                   | Riscos principais                               |
| ----------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **0. Descoberta e arquitetura** ✅        | Fronteiras e decisões antes de código | Diagramas C4, mapa de módulos, threat model, ADRs 1–6, roadmap                                                                                                             | Implementação não inicia sem fronteiras registradas                                                  | Análise infinita — timebox                      |
| **1. Fundação do monorepo**               | Estrutura técnica sem domínio         | pnpm + Turborepo, TS strict, ESLint 10, Prettier, Vitest, env validada, Docker Compose (PG+Redis), health check, CI, regras de dependência                                 | `pnpm install/lint/typecheck/test/build` verdes                                                      | Bikeshedding de tooling                         |
| **2. Identidade, tenant e permissões** ✅ | Fundação de segurança                 | tenants, orgs, users, memberships, roles, permissions, entitlements, RequestContext, audit log, RLS + papel restrito, auth de usuário e de aplicação, testes de isolamento | Usuário do tenant A não acessa nada do tenant B — verificado por suíte E2E contra PostgreSQL real    | Complexidade de RBAC/ABAC — começar mínimo      |
| **3. Primeiro fluxo vertical (CRM)** ✅   | Ponta a ponta real                    | Clientes, notas e agendamentos: domínio com invariantes, use cases, Drizzle + RLS, REST no módulo, 7 tools MCP, auditoria, testes unit/integração/E2E (tela React adiada)  | REST e MCP executam exatamente os mesmos use cases — verificado em teste                             | Escopo crescer — escopo mínimo acordado         |
| **4. OpenAPI e SDK** ✅                   | Contrato como produto                 | OpenAPI 3.1 gerado dos schemas Zod, deriva barrada no CI, SDK tipado com sessão e renovação, docs de versionamento e depreciação                                           | Consumidor usa só o SDK gerado, zero tipos manuais — verificado em E2E                               | Detecção semântica de breaking change pendente  |
| **5. MCP Gateway**                        | Capacidades para agentes              | Bootstrap MCP, Streamable HTTP, authz, registry, 5 tools CRM, resources, prompts, auditoria, testes, docs de conexão                                                       | Host autorizado descobre e executa apenas tools do seu tenant                                        | Evolução do protocolo — inspector no CI         |
| **6. Module Registry e Plugin SDK**       | Extensão controlada                   | Manifest schema, registries, instalação por tenant, secrets, health, feature flags, plugin-sdk, plugin exemplo `notifications-example`                                     | Ativar/desativar plugin em um tenant não afeta outros                                                | Generalização precoce do SDK                    |
| **7. Expansão dos módulos**               | Verticais de negócio                  | Ordem: Commercial → Contracts → Assets → Operations → Billing → Finance → Inventory → Maintenance → RH; cada um com domínio, REST, MCP, eventos, UI, testes, auditoria     | Cada módulo entrega ao menos um fluxo de negócio completo                                            | Módulos rasos em paralelo — um vertical por vez |
| **8. Eventos, integrações e jobs**        | Confiabilidade assíncrona             | Outbox + dispatcher, BullMQ, retries, idempotência, DLQ, webhooks assinados, replay, circuit breaker, rate limit                                                           | Falha temporária de integração não desfaz transação nem derruba API                                  | Semântica de retry mal definida                 |
| **9. MCP Apps e UIs de plugin**           | Interfaces interativas                | App exemplo (form + dashboard), CSP, sandbox, validação de mensagens, fallback textual                                                                                     | Host sem suporte a Apps continua usando a tool estruturada                                           | Depender de host específico                     |
| **10. Observabilidade e segurança**       | Confiança operacional                 | OTel completo, dashboards, alertas, auditoria consultável, rate limiting, headers, secret management, backup/restore testado, runbooks, carga                              | Responder: quem, qual tenant, qual interface, qual use case, quanto tempo, resultado, correlation ID | Instrumentação tardia — base já na Fase 1       |
| **11. Implantação e escala**              | Escala horizontal                     | Imagens Docker, staging/prod, migrations controladas, readiness, graceful shutdown, zero-downtime, deploy independente api/mcp/worker                                      | API e MCP escalam sem estado local                                                                   | Migrations incompatíveis — expand/contract      |
| **12. Extração seletiva**                 | Processo, não execução                | Contratos estáveis → eventos versionados → testes de contrato → novo deployable → adapter remoto → migração de dados → cutover                                             | Extração sem mudanças relevantes nos consumidores                                                    | Extrair sem justificativa concreta              |

### Fase 3 — escopo entregue

Escopo reduzido a pedido: **clientes, notas e agendamentos** (o cliente é o
substrato de que notas e agenda dependem). Entregue com domínio, casos de uso,
persistência com RLS, REST, contribuição MCP, auditoria e testes.

Ficou **fora** desta entrega, deliberadamente:

| Item                          | Por quê                                                | Quando                     |
| ----------------------------- | ------------------------------------------------------ | -------------------------- |
| Tela React (`apps/web`)       | O pedido foi de recursos mínimos; o SDK já está pronto | Próxima fase de produto    |
| Gateway MCP rodando           | As tools existem e são testadas; falta o transporte    | Fase 5                     |
| Eventos publicados via outbox | Declarados no manifesto, ainda não emitidos            | Fase 8                     |
| Reagendar (mudar horário)     | Cancelar + agendar cobre o caso                        | Quando houver demanda real |
| Arquivar cliente por rota     | A regra existe no domínio, sem endpoint                | Quando houver demanda real |

## Sequência imediata

1. ✅ Fase 0 — arquitetura, diagramas C4 e ADRs.
2. ✅ Fase 1 — fundação do monorepo (lint, typecheck, testes, build, Docker, CI).
3. ✅ Fase 2 — identidade, tenant, permissões, auditoria e isolamento testado.
4. ✅ Fase 3 — CRM mínimo (clientes, notas, agendamentos), com REST e a
   contribuição MCP chamando exatamente os mesmos casos de uso.
5. ✅ Fase 4 — OpenAPI 3.1 gerado do código, SDK tipado em `packages/api-client`,
   deriva de contrato barrada no CI.
6. **Fase 5** — MCP Gateway: as 7 tools do CRM já existem e são testadas; falta o
   transporte (Streamable HTTP), a descoberta filtrada por tenant e a autorização.

### Dívidas conhecidas ao fim da Fase 2

| Item                                                                                       | Impacto                                       | Quando resolver                                      |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------- |
| Resolver o acesso abre 4 transações por requisição (tenant, vínculo, papéis, contratações) | Latência extra em toda rota autenticada       | Fase 3: uma única transação por resolução            |
| ABAC ainda é só o gancho de política (só RBAC + escopos estão em uso)                      | Regras de alçada por valor não existem        | Fase 7, com Comercial/Financeiro                     |
| Sem rate limiting no login                                                                 | Força bruta só é contida pelo custo do scrypt | Fase 10                                              |
| Rotação de refresh token não é atômica (emite e depois revoga)                             | Janela mínima de corrida em uso concorrente   | Fase 8, junto com a unidade de trabalho transacional |
| Sem cache — a regra de segmentação por tenant existe, mas não tem sujeito                  | Nenhum                                        | Ao introduzir o primeiro cache                       |
