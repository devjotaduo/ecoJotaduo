# Roadmap de implementação

Fases estritamente ordenadas; cada fase termina com lint + typecheck + testes + build
executados de verdade, documentação atualizada e riscos declarados. Nenhum módulo é
"pronto" com apenas tabela e CRUD.

| Fase                                      | Objetivo                              | Entregáveis-chave                                                                                                                                                                             | Critério de aceite                                                                                   | Riscos principais                                |
| ----------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **0. Descoberta e arquitetura** ✅        | Fronteiras e decisões antes de código | Diagramas C4, mapa de módulos, threat model, ADRs 1–6, roadmap                                                                                                                                | Implementação não inicia sem fronteiras registradas                                                  | Análise infinita — timebox                       |
| **1. Fundação do monorepo**               | Estrutura técnica sem domínio         | pnpm + Turborepo, TS strict, ESLint 10, Prettier, Vitest, env validada, Docker Compose (PG+Redis), health check, CI, regras de dependência                                                    | `pnpm install/lint/typecheck/test/build` verdes                                                      | Bikeshedding de tooling                          |
| **2. Identidade, tenant e permissões** ✅ | Fundação de segurança                 | tenants, orgs, users, memberships, roles, permissions, entitlements, RequestContext, audit log, RLS + papel restrito, auth de usuário e de aplicação, testes de isolamento                    | Usuário do tenant A não acessa nada do tenant B — verificado por suíte E2E contra PostgreSQL real    | Complexidade de RBAC/ABAC — começar mínimo       |
| **3. Primeiro fluxo vertical (CRM)** ✅   | Ponta a ponta real                    | Clientes, notas e agendamentos: domínio com invariantes, use cases, Drizzle + RLS, REST no módulo, 7 tools MCP, auditoria, testes unit/integração/E2E (tela React adiada)                     | REST e MCP executam exatamente os mesmos use cases — verificado em teste                             | Escopo crescer — escopo mínimo acordado          |
| **4. OpenAPI e SDK** ✅                   | Contrato como produto                 | OpenAPI 3.1 gerado dos schemas Zod, deriva barrada no CI, SDK tipado com sessão e renovação, docs de versionamento e depreciação                                                              | Consumidor usa só o SDK gerado, zero tipos manuais — verificado em E2E                               | Detecção semântica de breaking change pendente   |
| **5. MCP Gateway** ✅                     | Capacidades para agentes              | `apps/mcp-gateway` com Streamable HTTP sem sessão, `packages/mcp-kit` (contrato + catálogo autorizado), 7 tools, 2 resources, 1 prompt, auditoria, E2E com o cliente oficial, docs de conexão | Host autorizado descobre e executa apenas as capacidades do seu tenant — verificado em E2E           | Fluxo OAuth 2.1 do MCP ainda não implementado    |
| **6. Module Registry e Plugin SDK** ✅    | Extensão controlada                   | `packages/plugin-sdk` (manifesto validado + runtime), `modules/plugins` (catálogo, instalação por empresa, segredos cifrados, health), plugin `notifications-example` com REST e MCP          | Ativar/desativar plugin em uma empresa não afeta outras — verificado em E2E                          | Plugin externo (out-of-process) ainda não existe |
| **7. Expansão dos módulos**               | Verticais de negócio                  | Ordem: Commercial → Contracts → Assets → Operations → Billing → Finance → Inventory → Maintenance → RH; cada um com domínio, REST, MCP, eventos, UI, testes, auditoria                        | Cada módulo entrega ao menos um fluxo de negócio completo                                            | Módulos rasos em paralelo — um vertical por vez  |
| **8. Eventos, integrações e jobs**        | Confiabilidade assíncrona             | Outbox + dispatcher, BullMQ, retries, idempotência, DLQ, webhooks assinados, replay, circuit breaker, rate limit                                                                              | Falha temporária de integração não desfaz transação nem derruba API                                  | Semântica de retry mal definida                  |
| **9. MCP Apps e UIs de plugin**           | Interfaces interativas                | App exemplo (form + dashboard), CSP, sandbox, validação de mensagens, fallback textual                                                                                                        | Host sem suporte a Apps continua usando a tool estruturada                                           | Depender de host específico                      |
| **10. Observabilidade e segurança**       | Confiança operacional                 | OTel completo, dashboards, alertas, auditoria consultável, rate limiting, headers, secret management, backup/restore testado, runbooks, carga                                                 | Responder: quem, qual tenant, qual interface, qual use case, quanto tempo, resultado, correlation ID | Instrumentação tardia — base já na Fase 1        |
| **11. Implantação e escala**              | Escala horizontal                     | Imagens Docker, staging/prod, migrations controladas, readiness, graceful shutdown, zero-downtime, deploy independente api/mcp/worker                                                         | API e MCP escalam sem estado local                                                                   | Migrations incompatíveis — expand/contract       |
| **12. Extração seletiva**                 | Processo, não execução                | Contratos estáveis → eventos versionados → testes de contrato → novo deployable → adapter remoto → migração de dados → cutover                                                                | Extração sem mudanças relevantes nos consumidores                                                    | Extrair sem justificativa concreta               |

### Fase 3 — escopo entregue

Escopo reduzido a pedido: **clientes, notas e agendamentos** (o cliente é o
substrato de que notas e agenda dependem). Entregue com domínio, casos de uso,
persistência com RLS, REST, contribuição MCP, auditoria e testes.

Ficou **fora** desta entrega, deliberadamente:

| Item                          | Por quê                                                | Quando                     |
| ----------------------------- | ------------------------------------------------------ | -------------------------- |
| Tela React (`apps/web`)       | O pedido foi de recursos mínimos; o SDK já está pronto | Próxima fase de produto    |
| Gateway MCP rodando           | As tools existem e são testadas; falta o transporte    | ✅ entregue na Fase 5      |
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
6. ✅ Fase 5 — Gateway MCP: transporte Streamable HTTP sem sessão, catálogo filtrado
   por empresa, papéis e módulo contratado, resources e prompt do CRM.
7. ✅ Fase 6 — Registry de plugins: instalação por empresa, segredos cifrados,
   permissões concedidas na instalação e o primeiro plugin first-party de verdade.
8. **Fase 7 (em andamento)** — Expansão dos módulos, um vertical por vez.
   ✅ **Commercial** (propostas: elaborar → enviar → decidir).
   ✅ **Contracts** (formalizar da proposta aceita → ativar → encerrar).
   Próximo: Assets → Operations → Billing → Finance → Inventory → Maintenance → RH.

### Fase 5 — escopo entregue

`apps/mcp-gateway` monta o MESMO núcleo da API REST (`criarNucleo`, agora em
`packages/platform-core`) e liga só a borda. O catálogo (`McpCatalog`) recebe o
`AccessGrant` em todo método: descoberta e execução passam pela mesma decisão, então
uma tool que não aparece na listagem também não executa se o host adivinhar o nome.

Ficou **fora** desta entrega, deliberadamente:

| Item                                   | Por quê                                                                    | Quando                  |
| -------------------------------------- | -------------------------------------------------------------------------- | ----------------------- |
| Fluxo OAuth 2.1 do MCP                 | A plataforma não é Authorization Server; bearer próprio conecta hoje       | Fase própria (ADR-0009) |
| Chave de idempotência em escritas      | A proteção real hoje é a invariante de domínio; sem retry automático ainda | Fase 8                  |
| Federação de servidores MCP de plugins | O MCP local precisa estar estável primeiro (ADR-0004)                      | Fase 6+                 |
| MCP Apps (UI interativa)               | Depende do catálogo estável                                                | Fase 9                  |
| `outputSchema` / `structuredContent`   | Exigiria schema de saída por tool, com risco de deriva, sem consumidor     | Quando um host pedir    |
| `stdio` para dev                       | O host de teste é HTTP; um segundo transporte sem uso é peso morto         | Se aparecer demanda     |

### Fase 6 — escopo entregue

Um plugin habilitado vira **entitlement** (`plugin.<id>`), então rota REST e tool MCP
passam a enxergá-lo sem código novo em nenhuma das bordas (ADR-0010). O plugin age com
a interseção entre o que a instalação concedeu e os módulos ainda contratados — nunca
com os poderes de quem o chamou.

Ficou **fora** desta entrega, deliberadamente:

| Item                                   | Por quê                                                                       | Quando                |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------- |
| Plugin Gateway (plugins externos)      | Nenhum plugin externo existe; o manifesto já distingue `remote`               | Quando houver um      |
| `manifest.schema.json` versionado      | O Zod já valida; o JSON só serve a autor externo                              | Idem                  |
| Feature flags genéricas                | Habilitar/desabilitar plugin cobre o caso; o risco da fase é generalizar cedo | Quando houver 2º caso |
| Migrações próprias de plugin           | O plugin de exemplo não tem tabelas                                           | Quando um pedir       |
| Assinatura de eventos (`subscribesTo`) | Não há barramento; o manifesto já recusa evento inexistente                   | Fase 8                |
| UI de plugin                           | Depende de `apps/web`                                                         | Fase 9                |

### Fase 7 — Commercial (primeiro vertical)

Escopo mínimo com fluxo fechado: proposta para um cliente do CRM, com itens em
centavos, envio (que congela os valores) e decisão do cliente. Cinco tools MCP sobre
os mesmos casos de uso do REST, incluindo `commercial.proposal.approve` — a intenção
de negócio que o modelo MCP cita como exemplo.

Duas escolhas de desenho que valem registro:

- **`expired` é derivado, não guardado.** Se fosse coluna, dependeria de um job rodar
  para virar verdade, e uma proposta vencida ficaria "enviada" até lá. Derivando de
  `validUntil`, ela vence no instante certo, sem agendador.
- **Número por empresa vem de contador atômico**, não de `max(number) + 1`: duas
  criações simultâneas leriam o mesmo máximo. Há teste com cinco criações em paralelo.

Ficou **fora**, deliberadamente:

| Item                                      | Por quê                                                                 | Quando                |
| ----------------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| Dependência de Catalog (item de catálogo) | Catalog não existe; no escopo mínimo o item é descrito à mão            | Quando Catalog vier   |
| Versionamento de proposta (revisões)      | Recusar alteração após o envio já protege o combinado                   | Quando houver demanda |
| PDF da proposta                           | Depende de Documents, transversal ainda não implementado                | Fase 9+               |
| Eventos publicados                        | Declarados no manifesto, sem barramento até a Fase 8                    | Fase 8                |
| Desconto no cabeçalho da proposta         | Desconto por item cobre o caso; total no cabeçalho duplicaria a verdade | Se pedirem            |

### Fase 7 — Contracts (segundo vertical)

Um contrato nasce de uma proposta **aceita**: cliente, título, moeda e valor vêm dela,
e não de quem formaliza — se viessem, o contrato poderia divergir do que o cliente
aceitou e a proposta deixaria de significar alguma coisa. Uma proposta vira um
contrato só (regra no caso de uso, restrição de unicidade no banco como rede de baixo).

`expired` segue o padrão do Comercial: derivado de `endsOn`, nunca guardado. Encerrar
formalmente um contrato de vigência vencida continua sendo operação válida — é assim
que a situação deixa de ser `expired` e vira `finished`.

A ligação com o Comercial é por **chamada direta ao caso de uso**, via superfície
pública. O barramento de eventos entra na Fase 8, onde a durabilidade é o ponto; até
lá, chamada direta é honesta e não esconde o acoplamento.

Ficou **fora**, deliberadamente:

| Item                            | Por quê                                                     | Quando                      |
| ------------------------------- | ----------------------------------------------------------- | --------------------------- |
| Renovação / aditivo de contrato | Encerrar e formalizar um novo cobre o caso no escopo mínimo | Quando houver demanda       |
| Reajuste por índice             | Depende de Finance                                          | Fase 7, com Finance         |
| Contrato sem proposta (avulso)  | Contradiz a regra que define o módulo                       | Se o negócio pedir, com ADR |
| Anexos (documento assinado)     | Depende de Documents, transversal ainda não implementado    | Fase 9+                     |
| Eventos publicados              | Declarados no manifesto, sem barramento até a Fase 8        | Fase 8                      |

### Dívidas conhecidas ao fim da Fase 2

| Item                                                                                                                | Impacto                                       | Quando resolver                                      |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Resolver o acesso abre **5** transações por requisição (tenant, vínculo, papéis, contratações, plugins habilitados) | Latência extra em toda rota autenticada       | Vencida desde a Fase 3; agrupar em uma transação     |
| ABAC ainda é só o gancho de política (só RBAC + escopos estão em uso)                                               | Regras de alçada por valor não existem        | Fase 7, com Comercial/Financeiro                     |
| Sem rate limiting no login                                                                                          | Força bruta só é contida pelo custo do scrypt | Fase 10                                              |
| Rotação de refresh token não é atômica (emite e depois revoga)                                                      | Janela mínima de corrida em uso concorrente   | Fase 8, junto com a unidade de trabalho transacional |
| Sem cache — a regra de segmentação por tenant existe, mas não tem sujeito                                           | Nenhum                                        | Ao introduzir o primeiro cache                       |
| Negação de acesso não é auditada (nem no REST nem no MCP)                                                           | Agente sondando o catálogo não deixa rastro   | Fase 10, nas duas bordas de uma vez                  |
| Sem rate limiting por credencial no gateway MCP                                                                     | Agente em laço custa banco                    | Fase 10, junto com o do login                        |
| Webhook de plugin: janela de DNS rebinding entre resolver e conectar                                                | SSRF residual em cenário elaborado            | Ao introduzir camada de saída controlada (Fase 10)   |
| `SECRETS_KEY` não tem rotação                                                                                       | Trocar a chave hoje invalida os segredos      | Quando houver o segundo ambiente de produção         |
