# Glossário

| Termo | Definição |
|---|---|
| **Tenant** | Empresa cliente da plataforma; unidade de isolamento de dados, cache, jobs e tools |
| **Organization** | Agrupador comercial que pode possuir um ou mais tenants |
| **Membership** | Vínculo usuário ↔ tenant, com papéis (roles) |
| **Module Entitlement** | Licença que habilita um módulo para um tenant |
| **Módulo interno** | Domínio de negócio do core (ex.: CRM), executa in-process |
| **Plugin first-party** | Extensão da própria equipe, ativável por tenant, pacote confiável do monorepo |
| **Plugin externo** | Extensão de terceiros; executa sempre fora do processo, atrás do Plugin Gateway |
| **Manifest** | Declaração versionada de identidade, permissões, capacidades e eventos de um módulo/plugin |
| **Contribution** | O que um módulo oferece a um composition root: http, mcp, jobs, events, navigation, permissions, migrations |
| **Composition root** | App que monta módulos + adapters de uma borda (api, mcp-gateway, worker) |
| **Caso de uso (use case)** | Operação de negócio da camada application; único ponto de regra para REST, MCP, jobs e webhooks |
| **Port** | Interface requerida pelo application/domain (ex.: repositório) |
| **Adapter** | Implementação de uma borda (HTTP, MCP, persistência, jobs) |
| **Contracts** | Superfície pública de um módulo (`public-api.ts`, `events.ts`, `schemas.ts`) — único import permitido entre módulos |
| **TenantContext** | Contexto por request/job (tenant, usuário, correlation) propagado via AsyncLocalStorage |
| **Entitlement check** | Verificação de que o tenant contratou o módulo antes da política de permissão |
| **RBAC / ABAC** | Autorização por papéis / por atributos contextuais (alçada, propriedade, unidade) |
| **Scope** | Permissão declarada num token (API ou MCP); vale a interseção com RBAC/ABAC |
| **RLS** | Row-Level Security do PostgreSQL; defesa em profundidade do isolamento por tenant |
| **Evento de integração** | Fato de negócio publicado via outbox para outros módulos/plugins |
| **Outbox transacional** | Tabela onde eventos são gravados na mesma transação do dado; worker publica depois |
| **DLQ** | Dead-letter queue: destino de mensagens que esgotaram retries, com replay controlado |
| **Correlation / Causation ID** | Rastreiam a cadeia de uma ação através de requests, eventos e jobs |
| **Idempotency key** | Chave enviada pelo cliente que torna uma mutação repetível sem efeito duplo |
| **MCP** | Model Context Protocol; protocolo para agentes descobrirem e executarem capacidades |
| **MCP tool/resource/prompt** | Ação de negócio / fonte de contexto / template especializado expostos ao agente |
| **MCP App** | Interface interativa opcional retornada por uma tool (renderizada pelo host em sandbox) |
| **Streamable HTTP** | Transporte MCP remoto usado em produção |
| **Federação MCP** | Gateway agregando servidores MCP externos com namespace e filtros (pós-MVP) |
| **Money** | Valor monetário como inteiro em unidade mínima (centavos) + moeda; nunca float |
