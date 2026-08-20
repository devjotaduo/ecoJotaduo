# ADR-0005 — Isolamento de plugins em três categorias

- **Status**: aceito
- **Data**: 2026-08-20

## Problema

A plataforma será extensível por integrações (WhatsApp, Google Workspace, GitHub, ERPs
de terceiros) e, futuramente, por código de terceiros. Código não confiável não pode
comprometer o núcleo, os dados ou o isolamento entre tenants.

## Alternativas consideradas

1. **Carregar JavaScript de terceiros no processo principal** (require/import
   dinâmico) — simples e inaceitável: sem sandbox real em Node.
2. **Tudo é serviço externo** — até integrações próprias virariam microsserviços,
   contradizendo o ADR-0001.
3. **Modelo em três categorias com níveis de confiança distintos.**

## Decisão

Adotar o modelo em **três categorias** (alternativa 3):

| Categoria                        | Exemplos                           | Execução                                                                             | Registro                               |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------- |
| **Módulo interno**               | CRM, Financeiro, Operação          | In-process, mesmo deploy                                                             | Build/bootstrap controlado             |
| **Plugin próprio (first-party)** | WhatsApp, Google Workspace, GitHub | Pacote confiável do monorepo (`plugins/first-party/*`), ativável por tenant          | Manifesto + ciclo de vida + permissões |
| **Plugin externo**               | Código de terceiros                | **Sempre out-of-process**: container/processo/serviço remoto atrás do Plugin Gateway | Manifesto + contratos controlados      |

Regras:

- Nunca baixar e executar JavaScript arbitrário no processo principal (backend ou
  frontend).
- Integração de plugins externos apenas por contratos controlados: OpenAPI, webhooks
  assinados, filas, eventos, OAuth e MCP remoto — via `plugin-sdk`.
- Manifesto versionado validado por JSON Schema (`manifestVersion`, permissões,
  capacidades, eventos consumidos/publicados, faixa de versão de plataforma).
- Ciclo de vida explícito por tenant: `available → installed → configured → enabled →
healthy → disabled → uninstalled`, com auditoria, health check e versão registrados.
- Permissões de plugin são **concedidas explicitamente na instalação** e verificadas
  server-side em cada chamada, como qualquer outro cliente.
- UI de plugin externo somente em iframe com sandbox, CSP e protocolo de mensagens
  validado; UI de plugin first-party pode ser compilada junto ao app web.

## Benefícios

- Núcleo protegido por construção; falha de plugin não derruba a plataforma.
- O mesmo manifesto serve first-party e externo — caminho natural para marketplace.
- Ativação por tenant sem afetar os demais.

## Riscos

- Latência e complexidade operacional da ponte para externos — aceitas; mitigadas com
  timeout, retry idempotente, circuit breaker e DLQ.
- Custo de manter o `plugin-sdk` — mitigado começando por um único plugin de exemplo.

## Impacto da migração

Um plugin first-party que precise virar externo (ou vice-versa) mantém manifesto e
contratos; muda apenas o local de execução.
