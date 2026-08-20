# Fase 0 — Descoberta: inventário, requisitos, riscos e suposições

Data: 2026-08-20

## 1. Inventário do repositório

- Diretório de trabalho: `C:\Users\ruthe\Desktop\erp` — **vazio** no início do
  projeto (greenfield). Não há código legado a preservar nem repositório git prévio.
- Ambiente local verificado: Node 24.13.0, pnpm 10.28.2, git 2.55.0, Docker 29.6.2
  (Windows 11).
- Decisão: este diretório é a raiz do monorepo `ecojotaduo-platform`.

## 2. Mapa do domínio (resumo)

ERP para empresa de **locação de equipamentos e serviços** — a tríade
Locações/Equipamentos/Manutenção no briefing indica o setor. (O projeto nasceu com
o nome provisório "Movimentar", que também apontava para movimentação de
equipamentos; foi renomeado para ecoJotaduo em 2026-08-20, sem mudança de escopo.) Bounded contexts e suas
relações estão em [module-map.md](module-map.md). Núcleo de valor: ciclo
**CRM → Proposta → Contrato → Locação/Operação → Faturamento → Financeiro**, apoiado
por Ativos, Estoque, Manutenção, Documentos e Notificações.

## 3. Requisitos funcionais (síntese por módulo)

| Módulo         | Responsabilidade essencial                                             |
| -------------- | ---------------------------------------------------------------------- |
| Identity       | Usuários, credenciais, sessões, service accounts, OAuth clients        |
| Tenancy        | Organizações, tenants, memberships, entitlements de módulos            |
| Employees (RH) | Funcionários, cargos, vínculos, documentos trabalhistas                |
| CRM            | Clientes, contatos, histórico de interações                            |
| Catalog        | Catálogo de itens/serviços locáveis e vendáveis, tabelas de preço      |
| Commercial     | Propostas, negociação, aprovação comercial                             |
| Contracts      | Contratos, vigência, aditivos, ativação                                |
| Assets         | Equipamentos/ativos, identificação, disponibilidade, telemetria futura |
| Inventory      | Estoque de peças/insumos, movimentações                                |
| Operations     | Locações, programação/agenda, apontamentos de operação                 |
| Maintenance    | Ordens de serviço, planos preventivos, execução                        |
| Billing        | Medição/competência, geração de faturas                                |
| Finance        | Contas a pagar/receber, baixas, conciliação, fluxo de caixa            |
| Documents      | Arquivos/documentos vinculados a registros (transversal)               |
| Notifications  | Notificações multicanal disparadas por eventos (transversal)           |

Cada módulo só é considerado pronto com **um fluxo de negócio completo** (nunca apenas
tabela + CRUD).

## 4. Requisitos não funcionais

| Categoria       | Requisito                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segurança       | Autorização server-side em todas as superfícies; RBAC + ABAC + scopes; auditoria de ações relevantes; segredos fora do código; LGPD (dados pessoais de clientes e funcionários) |
| Isolamento      | Nenhum dado, cache, job, evento ou tool MCP cruza tenants; testes de isolamento obrigatórios                                                                                    |
| Desempenho      | p95 < 300 ms em leituras típicas da API; paginação obrigatória em listagens                                                                                                     |
| Disponibilidade | Alvo MVP 99,5%; API/MCP/worker escaláveis horizontalmente, sem estado em memória                                                                                                |
| Confiabilidade  | Outbox transacional; jobs idempotentes com retry + DLQ; sem retries infinitos                                                                                                   |
| Observabilidade | OpenTelemetry (logs estruturados, traces, métricas) com tenant e correlation ID                                                                                                 |
| Dados           | Datas em UTC; dinheiro como inteiro em centavos + moeda (BRL padrão); IDs opacos (UUIDv7)                                                                                       |
| Backup          | RPO ≤ 24h no MVP (alvo 1h), RTO ≤ 4h; teste de restore periódico                                                                                                                |
| i18n            | Produto em pt-BR; identificadores de código em inglês                                                                                                                           |

## 5. Riscos principais

| #   | Risco                                                                    | Mitigação                                                                       |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1   | Escopo amplo vs. equipe pequena — tentação de abrir muitos módulos rasos | Fases verticais; critério "fluxo completo ou nada"                              |
| 2   | Erosão das fronteiras entre módulos                                      | Pacotes pnpm + lint de camadas + revisão                                        |
| 3   | Vazamento entre tenants                                                  | Repositórios tipados por TenantId + RLS + testes de isolamento                  |
| 4   | Superfície MCP explorada por prompt injection                            | Authz server-side, tools de intenção (nunca genéricas), auditoria, idempotência |
| 5   | Majors recentes (Vite 8, Vitest 4, ESLint 10) com ecossistema atrasado   | Peers verificados (ADR-0006); upgrades por PR dedicado                          |
| 6   | Banco único virar gargalo                                                | Índices por tenant, projeções de leitura, extração seletiva (Fase 12)           |
| 7   | Credenciais de integrações vazarem via modelo/logs                       | Tokens cifrados server-side, nunca retornados ao modelo, scrub de logs          |

## 6. Suposições assumidas (não informadas no enunciado)

1. **Greenfield**: não há sistema legado nem dados a migrar.
2. **Raiz do projeto** é o diretório atual (`erp/`); o produto se chama
   `ecojotaduo-platform` no `package.json` e o escopo npm é `@ecojotaduo/*`.
3. **Idioma**: produto e documentação em pt-BR; identificadores de código, nomes de
   arquivos e permissões em inglês (convenção estabelecida pelos exemplos do briefing).
4. **Moeda**: BRL como padrão; valores monetários em centavos (inteiro) + código de moeda.
5. **Autenticação MVP**: e-mail/senha própria (argon2) emitindo JWT curto + refresh
   token rotacionado, com estrutura pronta para federar OIDC corporativo depois.
6. **Deploy inicial**: uma VM com Docker Compose (API, MCP, worker, Postgres, Redis,
   proxy TLS); Kubernetes-ready mas sem K8s no MVP.
7. **Time-zone de exibição**: America/Sao_Paulo por padrão do tenant (armazenamento UTC).
8. **Volumetria MVP**: dezenas de tenants, centenas de usuários, milhares de
   registros/mês por tenant — sem necessidade de particionamento precoce.
9. **LGPD** se aplica (dados de clientes e funcionários no Brasil).
10. E-mail transacional, object storage (S3-compatível) e WhatsApp são integrações
    futuras; nenhum provedor foi contratado ainda.
