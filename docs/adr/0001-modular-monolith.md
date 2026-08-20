# ADR-0001 — Monólito modular como arquitetura inicial

- **Status**: aceito
- **Data**: 2026-08-20

## Problema

A Movimentar Platform precisa entregar um ERP multi-tenant com mais de uma dezena de
domínios de negócio (CRM, comercial, contratos, operação, faturamento, financeiro,
ativos, manutenção…), servindo web, mobile, integrações de terceiros e agentes de IA —
com uma equipe pequena e um prazo de MVP curto. É necessário começar simples sem
fechar o caminho para escala e extração futura de serviços.

## Alternativas consideradas

1. **Microsserviços desde o primeiro dia** — um serviço por domínio, comunicação via
   rede desde o início.
2. **Monólito clássico em camadas** — um único pacote com camadas horizontais
   (controllers/services/repositories) compartilhadas por todos os domínios.
3. **Monólito modular** — um único deploy inicial, mas com cada domínio isolado em um
   pacote próprio do monorepo, com fronteiras impostas por ferramenta.

## Decisão

Adotar o **monólito modular** (alternativa 3):

- Cada domínio vive em `modules/<nome>` como pacote pnpm independente, organizado em
  arquitetura hexagonal (`domain`, `application`, `ports`, `adapters`, `contracts`).
- As fronteiras são impostas estruturalmente: um módulo só enxerga outro pacote se o
  declarar como dependência no `package.json`, e só pode importar os *exports públicos*
  (`contracts/`), nunca o interior (`src/**`). Regras de lint reforçam as camadas.
- Três composition roots reutilizam os mesmos módulos: `apps/api` (REST),
  `apps/mcp-gateway` (MCP) e `apps/worker` (jobs/eventos).
- Comunicação entre módulos: contratos públicos, casos de uso exportados, eventos
  internos e eventos de integração via outbox — nunca acesso direto a tabelas alheias.

Um módulo só será extraído para serviço independente mediante justificativa concreta
(escala divergente, isolamento de falha, requisito regulatório, equipe própria, ciclo
de deploy próprio), seguindo o processo da Fase 12 do roadmap.

## Benefícios

- Velocidade de desenvolvimento: refatoração entre módulos é barata, transações são
  locais, debugging é trivial comparado a sistemas distribuídos.
- Deploy e operação simples no MVP (uma VM com Docker Compose).
- O isolamento por pacote cria, desde o início, os contratos que uma futura extração
  exigiria — a extração vira mudança de infraestrutura, não reescrita.

## Riscos

- Erosão de fronteiras por pressa ("só dessa vez importo direto") — mitigado por
  regras automatizadas de dependência e revisão.
- Banco compartilhado pode virar gargalo — mitigado por índices, leitura projetada e,
  em último caso, extração seletiva.
- Build do monorepo cresce com o tempo — mitigado por cache do Turborepo.

## Impacto da migração

A extração futura (Fase 12) exige: contratos estáveis, eventos versionados, testes de
contrato, adapter remoto temporário e migração de dados — sem mudanças relevantes para
consumidores REST, MCP ou de eventos. Nada no desenho atual bloqueia esse caminho.
