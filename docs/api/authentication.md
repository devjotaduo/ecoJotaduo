# Autenticação da API

Decisões em [ADR-0007](../adr/0007-auth-and-rls-enforcement.md).
Implementado na Fase 2.

## Dois fluxos

| Fluxo              | Para quem                | Endpoint                  | Refresh                     |
| ------------------ | ------------------------ | ------------------------- | --------------------------- |
| Senha              | Pessoas (web, mobile)    | `POST /api/v1/auth/login` | Sim, com rotação            |
| Client credentials | Aplicações e integrações | `POST /api/v1/auth/token` | Não (reapresenta o segredo) |

## Login (usuário)

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "ana@empresa-a.com.br", "password": "…", "tenantSlug": "empresa-a" }
```

O `tenantSlug` é obrigatório: uma pessoa pode ter vínculo em várias empresas, e a
sessão é sempre **de uma empresa específica**. Consulte as empresas do usuário
autenticado em `GET /api/v1/auth/my-tenants`.

Resposta (200):

```jsonc
{
  "accessToken": "…", // JWT HS256, TTL padrão 15 min
  "accessTokenExpiresAt": "2026-08-20T18:15:00.000Z",
  "refreshToken": "…", // token opaco, TTL padrão 30 dias
  "refreshTokenExpiresAt": "2026-09-19T18:00:00.000Z",
  "tenant": { "id": "…", "slug": "empresa-a", "name": "Empresa A" },
  "user": { "id": "…", "name": "…", "email": "…" },
  "permissions": ["*"],
  "entitlements": ["identity", "tenancy"],
}
```

**O tenant fica preso ao token.** Não existe parâmetro de tenant em nenhuma rota —
nem para clientes REST, nem para agentes MCP. Trocar de empresa exige novo login.

### Respostas de erro uniformes

Senha errada, usuário inexistente, empresa inexistente e usuário sem vínculo devolvem
o **mesmo** 401 com o mesmo texto. É deliberado: evita enumerar usuários e descobrir
quais empresas usam a plataforma. O motivo real fica no log do servidor, com o
`correlationId`.

Exceção: empresa suspensa devolve 403 `tenant-inactive`, com mensagem clara — é
informação útil para quem tem credencial válida, e não revela nada a terceiros.

## Renovação

```http
POST /api/v1/auth/refresh
{ "refreshToken": "…" }
```

Cada uso **rotaciona**: o token apresentado é revogado e um novo é emitido. Se um
token já revogado for apresentado outra vez, isso indica vazamento — toda a família de
tokens do usuário é derrubada e um novo login passa a ser exigido.

A renovação **reconsulta o banco**: se o vínculo foi revogado, um papel mudou ou a
empresa foi suspensa, o resultado muda na hora. Um token antigo não perpetua
privilégios.

## Aplicações (client credentials)

```http
POST /api/v1/auth/token
{ "clientId": "integracao-erp", "clientSecret": "…" }
```

A service account pertence a uma empresa; o tenant do token vem dela, nunca do
pedido. Os escopos concedidos na criação da conta **são** as permissões dessa conta —
sempre limitadas pelos módulos que a empresa contratou.

## Usando o token

```http
GET /api/v1/modules
Authorization: Bearer <accessToken>
```

Toda requisição passa pela mesma cadeia, no servidor:

```text
token → tenant (do token) → vínculo e papéis → módulo contratado → permissão da rota
```

O acesso é resolvido **do banco a cada requisição** — revogar um papel ou cancelar um
módulo tem efeito imediato, sem esperar o access token expirar.

## Correlação

Toda resposta traz `x-correlation-id` (o valor enviado pelo cliente é preservado, se
houver). O mesmo id aparece nos logs, na auditoria e no corpo dos erros — é por ele
que se investiga uma requisição de ponta a ponta.
