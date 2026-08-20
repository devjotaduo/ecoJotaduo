# ADR-0004 — Gateway MCP como app dedicado

- **Status**: aceito
- **Data**: 2026-08-20

## Problema

Agentes de IA (Claude, ChatGPT, IDEs, agentes próprios) precisam descobrir e executar
capacidades de negócio da plataforma com a mesma segurança da API — sem duplicar regra
de negócio e sem expor ferramentas genéricas perigosas.

## Alternativas consideradas

1. **Endpoints MCP embutidos no `apps/api`** — menos processos, porém acopla ciclo de
   deploy/escala do tráfego de agentes ao tráfego web.
2. **Um servidor MCP por módulo** — federação prematura, N processos para operar.
3. **Gateway MCP único (`apps/mcp-gateway`)** — app dedicado que agrega contribuições
   MCP dos módulos e compartilha os mesmos casos de uso.

## Decisão

Adotar o **gateway MCP dedicado** (alternativa 3):

- SDK oficial TypeScript (`@modelcontextprotocol/sdk` 1.30.x).
- Transporte **Streamable HTTP** em produção; adaptador **stdio** opcional apenas para
  desenvolvimento local e testes. Domínio e casos de uso ignoram o transporte.
- Cada módulo exporta uma `McpContribution` (tools, resources, prompts, apps) em seu
  manifesto; o gateway monta o registry filtrando por tenant, licença de módulo
  (entitlement), escopos e permissões — toda verificação é server-side.
- Nomenclatura `dominio.entidade.acao` (ex.: `crm.customer.search`); ferramentas
  federadas de plugins usam prefixo `plugin.<id>.*`.
- Tools representam **intenções de negócio** e chamam os mesmos casos de uso da API.
  Proibidas ferramentas genéricas (`execute_sql`, `call_any_url`, etc.).
- Workflows multi-etapa usam identificadores opacos persistidos (`workflowId`,
  `draftId`, `approvalId`) revalidados a cada chamada — nenhum estado em memória de
  conexão.
- Federação de servidores MCP externos (de plugins) só após o MCP local estar estável
  (ver roadmap), via adapter de federação com namespace, filtros, timeout, circuit
  breaker e auditoria.

## Benefícios

- Escala e deploy independentes do tráfego de agentes.
- Superfície de ataque única, auditável, com catálogo controlado por tenant.
- Zero duplicação de regra: REST e MCP convergem nos mesmos casos de uso.

## Riscos

- Evolução rápida da especificação MCP — mitigada pelo SDK oficial e testes de
  compatibilidade de protocolo no CI.
- Drift entre catálogo MCP e permissões — mitigado por registry único derivado dos
  manifestos e testes de autorização.

## Impacto da migração

Se a especificação MCP mudar de transporte recomendado, apenas a borda do gateway é
afetada; contribuições dos módulos e casos de uso permanecem intactos.
