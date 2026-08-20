# Conectar um agente ao gateway MCP

Decisões em [ADR-0004](../adr/0004-mcp-gateway.md) e
[ADR-0009](../adr/0009-mcp-gateway-stateless-e-autenticacao.md); desenho em
[mcp-model](../architecture/mcp-model.md).

## O endpoint

| Item         | Valor                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------- |
| URL          | `http://127.0.0.1:3001/mcp` (porta em `MCP_PORT`)                                        |
| Transporte   | Streamable HTTP, **sem sessão**                                                          |
| Métodos      | `POST` (JSON-RPC). `GET`/`DELETE` respondem 405 — não há sessão a manter                 |
| Autenticação | `Authorization: Bearer <access token>` em **toda** requisição, inclusive no `initialize` |
| Saúde        | `GET /health` (sem autenticação)                                                         |

O gateway é um processo separado da API REST. Subir os dois localmente:

```bash
pnpm --filter @ecojotaduo/api dev
```

```bash
pnpm --filter @ecojotaduo/mcp-gateway dev
```

## A credencial

O token é o **mesmo** da API REST. Pegue um com o login da plataforma:

```bash
curl -s http://127.0.0.1:3000/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"admin@demo.local","password":"...","tenantSlug":"demo"}'
```

O campo `accessToken` da resposta é o que vai no cabeçalho. Para integração
sistema-a-sistema, use uma **service account** em vez de credencial de pessoa.

Três coisas que valem para qualquer host:

- **A empresa vem do token**, do claim `tid`. Nenhuma tool aceita parâmetro de
  empresa, e o modelo não tem como escolher em qual empresa opera.
- **O catálogo é por credencial.** Duas pessoas da mesma empresa podem ver conjuntos
  diferentes de tools, conforme os papéis. Quem não contratou o módulo não vê nada
  dele — e também não executa, mesmo mandando o nome exato.
- **O token expira** (15 min por padrão). O host precisa renovar por
  `POST /api/v1/auth/refresh` e reconectar; o gateway não renova sessão de ninguém.

## Configuração no host

Claude Code (`.mcp.json` no projeto) ou Claude Desktop:

```json
{
  "mcpServers": {
    "ecojotaduo": {
      "type": "http",
      "url": "http://127.0.0.1:3001/mcp",
      "headers": { "Authorization": "Bearer SEU_ACCESS_TOKEN" }
    }
  }
}
```

Para inspecionar o catálogo à mão, o inspector oficial:

```bash
npx @modelcontextprotocol/inspector
```

## O que o CRM publica hoje

**Tools** (`dominio.entidade.acao`):

| Tool                       | Permissão exigida          | R/W |
| -------------------------- | -------------------------- | --- |
| `crm.customer.search`      | `crm.customer.read`        | R   |
| `crm.customer.get`         | `crm.customer.read`        | R   |
| `crm.customer.create`      | `crm.customer.create`      | W   |
| `crm.note.add`             | `crm.note.create`          | W   |
| `crm.appointment.schedule` | `crm.appointment.schedule` | W   |
| `crm.appointment.complete` | `crm.appointment.update`   | W   |
| `crm.agenda.list`          | `crm.appointment.read`     | R   |

**Resources** (templates; `resources/list` volta vazio de propósito — a carteira de
clientes não é enumerável como recurso):

- `crm://customers/{customerId}` — ficha com linha do tempo
- `crm://customers/{customerId}/history` — só a linha do tempo

**Prompt**: `crm.customer.analysis` (argumento `customerId`) — roteiro de análise de
relacionamento já preenchido com os dados da empresa do token.

O `inputSchema` publicado é gerado do mesmo schema Zod que valida a chamada: o que o
agente lê não tem como divergir do que o servidor aceita.

## Erros

| O que aconteceu                                  | O que o host recebe                         |
| ------------------------------------------------ | ------------------------------------------- |
| Sem token, token inválido ou expirado            | HTTP 401 + `WWW-Authenticate: Bearer`       |
| Empresa suspensa                                 | HTTP 403                                    |
| Tool que não existe em nenhum catálogo           | JSON-RPC `-32601` (method not found)        |
| Tool real, mas fora do catálogo desta credencial | JSON-RPC `-32600`, com a razão da recusa    |
| Entrada fora do schema                           | JSON-RPC `-32602`, com a lista de violações |
| Regra de negócio recusou                         | `isError: true` no conteúdo da tool         |
| Falha interna                                    | JSON-RPC `-32603`, sem detalhe              |

A distinção que importa está entre as duas últimas linhas: **recusa de negócio não é
erro de protocolo**. "Esse CNPJ já está cadastrado" volta como resultado da tool, para
o agente corrigir e tentar de novo; "você não tem permissão" volta como erro, porque a
chamada não aconteceu. Falha interna nunca vira `isError` — virar texto para o modelo
raciocinar em cima seria convidá-lo a inventar contorno para um bug.

Toda resposta carrega `x-correlation-id`. Mande o seu no cabeçalho de mesmo nome para
amarrar a chamada do agente ao registro de auditoria.

## O que ainda não existe

| Item                                   | Onde entra                      |
| -------------------------------------- | ------------------------------- |
| Fluxo OAuth 2.1 e metadados de recurso | Fase própria (ver ADR-0009)     |
| Chave de idempotência em escritas      | Fase 8, junto com retry         |
| Federação de servidores MCP de plugins | Fase 6+                         |
| MCP Apps (UI interativa)               | Fase 9                          |
| `outputSchema` / `structuredContent`   | Quando um host consumidor pedir |
| Rate limiting por credencial           | Fase 10                         |
