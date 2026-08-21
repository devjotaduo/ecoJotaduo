# Autenticação da API

Decisões em [ADR-0007](../adr/0007-auth-and-rls-enforcement.md).
Implementado na Fase 2.

## Dois fluxos

| Fluxo              | Para quem                | Endpoint                  | Refresh                          |
| ------------------ | ------------------------ | ------------------------- | -------------------------------- |
| Senha              | Pessoas (navegador)      | `POST /api/v1/auth/login` | Sim, com rotação, **por cookie** |
| Client credentials | Aplicações e integrações | `POST /api/v1/auth/token` | Não (reapresenta o segredo)      |

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
  "refreshTokenExpiresAt": "2026-09-19T18:00:00.000Z",
  "tenant": { "id": "…", "slug": "empresa-a", "name": "Empresa A" },
  "user": { "id": "…", "name": "…", "email": "…" },
  "permissions": ["*"],
  "entitlements": ["identity", "tenancy"],
}
```

E, junto com a resposta, um cookie:

```http
Set-Cookie: ecojotaduo_refresh=…; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000
```

**O refresh token não aparece no corpo.** Ele vive nesse cookie desde a Fase 10:
`HttpOnly` significa que nenhum JavaScript o lê — nem o da própria aplicação. Antes
disso ele voltava no JSON e a tela o guardava no `sessionStorage`, de onde um script
injetado o levava embora. O que fica no corpo é só a data de expiração, que é
informação e não segredo.

Consequência para quem integra: o fluxo de senha assume um cliente que guarda cookies
(navegador, ou um cliente HTTP com _cookie jar_). Integração servidor-a-servidor usa
client credentials, que não tem refresh.

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
Cookie: ecojotaduo_refresh=…
```

Sem corpo: o token vem do cookie. Aceitá-lo também por corpo reabriria exatamente o
caminho que o cookie fecha — bastaria um XSS convencer a página a enviar o que roubou.

Cada uso **rotaciona**: o token apresentado é revogado e um novo é emitido (num cookie
novo). A revogação acontece **antes** da emissão, e a condição vive no próprio
`UPDATE` — de duas renovações simultâneas do mesmo token, exatamente uma vence, e a
perdedora é tratada como reuso. Reuso indica vazamento: toda a família de tokens do
usuário é derrubada e um novo login passa a ser exigido.

## Sair

```http
POST /api/v1/auth/logout
Cookie: ecojotaduo_refresh=…
```

Devolve 204, apaga o cookie e revoga a família inteira — sair numa aba vale nas
outras, e num equipamento perdido também. Existe porque o cookie é `HttpOnly`: a tela
não consegue apagá-lo sozinha.

Sem cookie também devolve 204: uma sessão já morta responder erro só atrapalharia
quem está saindo.

### Por que não há token de CSRF

Nenhuma rota de negócio é autenticada por cookie — o access token vai como `Bearer`,
então um POST forjado de outro site chega sem autorização nenhuma. Os únicos endpoints
que leem o cookie são `refresh` e `logout`, e `SameSite=Strict` mais o `Path` restrito
já impedem que uma requisição de outro site o carregue. Um token anti-CSRF fecharia
uma porta que não abre, ao custo de mais uma peça para manter em sincronia.

Isso impõe uma condição de implantação: **aplicação web e API precisam ser
_same-site_** em produção.

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
