# Modelo de plugins e extensões

Decisão registrada no [ADR-0005](../adr/0005-plugin-isolation.md).

## Três categorias

|              | Módulo interno             | Plugin first-party                       | Plugin externo                                  |
| ------------ | -------------------------- | ---------------------------------------- | ----------------------------------------------- |
| Quem escreve | Equipe da plataforma       | Equipe da plataforma                     | Terceiros                                       |
| Onde executa | In-process (mesmo deploy)  | In-process, pacote confiável do monorepo | **Fora do processo** (container/serviço remoto) |
| Ativação     | Entitlement por tenant     | Instalação + configuração por tenant     | Instalação + permissões + gateway               |
| Exemplos     | CRM, Finance, Operations   | WhatsApp, Google Workspace, GitHub       | Integrações de parceiros                        |
| Registro     | Build/bootstrap controlado | Plugin Registry                          | Plugin Registry + Plugin Gateway                |
| UI           | App web principal          | Compilada junto ao app web               | iframe sandbox + CSP + postMessage validado     |

```mermaid
flowchart LR
    REGISTRY["Plugin Registry"]
    BUILTIN["Módulo interno<br/>mesmo processo"]
    TRUSTED["Plugin próprio<br/>pacote confiável"]
    GATEWAY["Plugin Gateway"]
    REMOTE["Plugin externo<br/>processo/container separado"]

    REGISTRY --> BUILTIN
    REGISTRY --> TRUSTED
    REGISTRY --> GATEWAY
    GATEWAY --> REMOTE
```

Nunca: download e execução de JavaScript arbitrário no processo principal (backend ou
frontend).

## Manifesto (validado por JSON Schema)

```json
{
  "manifestVersion": "1",
  "id": "whatsapp",
  "name": "Integração WhatsApp",
  "version": "1.0.0",
  "publisher": "ecoJotaduo",
  "type": "remote",
  "platformVersion": "^1.0.0",
  "permissions": ["crm.customer.read", "notifications.send"],
  "capabilities": { "http": true, "events": true, "mcp": true, "ui": true },
  "subscribesTo": ["crm.customer.created.v1"],
  "publishes": ["notifications.message.sent.v1"]
}
```

O JSON Schema oficial viverá em `packages/plugin-sdk/schemas/manifest.schema.json`
(Fase 6) e será aplicado na instalação e no CI.

## Ciclo de vida por tenant

```text
available → installed → configured → enabled → healthy
                                        ↓
                                    disabled → uninstalled
```

Registrado por instalação: tenant, versão, configuração, permissões concedidas, data,
status, health check, última execução, erros, auditoria e migrações aplicadas.
Ativar/desativar um plugin em um tenant **não** afeta outros tenants.

## Integração de plugins externos — contratos controlados

- **OpenAPI**: chamam a API pública com OAuth client + scopes concedidos.
- **Webhooks assinados**: recebem eventos com HMAC + timestamp + anti-replay.
- **Filas/eventos**: consomem via ponte publicada pelo worker (nunca acesso direto ao
  Redis interno).
- **MCP remoto**: expõem servidor MCP próprio, federado pelo gateway com namespace
  `plugin.<id>.*`, filtros, timeout, circuit breaker e auditoria.
- **plugin-sdk**: tipos, cliente e helpers oficiais para tudo acima.

## Interfaces de plugin

- First-party: componentes compilados no app web, atrás das permissões do tenant.
- Externo: iframe com `sandbox`, CSP estrita, sem tokens internos, comunicação
  exclusivamente por protocolo de mensagens versionado e validado (schema) —
  nenhuma capacidade além das concedidas.
