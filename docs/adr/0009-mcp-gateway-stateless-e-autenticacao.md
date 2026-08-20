# ADR-0009 — Gateway MCP: stateless, autenticado pelo token da plataforma

- **Status**: aceito
- **Data**: 2026-08-20
- **Refina**: [ADR-0004](0004-mcp-gateway.md) (que decidiu o gateway dedicado e o
  transporte Streamable HTTP, mas não como a sessão e a credencial funcionariam)

## Problema

O ADR-0004 fixou _que_ existiria um gateway MCP. Implementá-lo trouxe três decisões
que ele não cobria e que mudam o desenho de segurança:

1. O transporte Streamable HTTP admite modo **com sessão** (o servidor emite um
   `Mcp-Session-Id` e guarda estado entre chamadas) e **sem sessão**.
2. A especificação MCP recomenda **OAuth 2.1** com metadados de _protected resource_;
   a plataforma já tem um emissor de token próprio e nenhum Authorization Server.
3. O gateway precisa dos mesmos casos de uso da API REST, mas `criarNucleo` morava
   dentro de `apps/api` — e um composition root não pode depender de outro.

## Decisão

### 1. Modo stateless (`sessionIdGenerator: undefined`)

Nenhum estado entre chamadas. Cada requisição HTTP verifica o token, resolve o acesso
no banco, monta um `Server` MCP com o catálogo daquele grant, responde e descarta tudo.

O motivo não é simplicidade de operação (embora ela venha de brinde: qualquer réplica
atende qualquer requisição, sem afinidade). **Sessão seria um segundo lugar onde
tenant e permissões existem** — e é exatamente aí que mora a falha clássica de gateway
de agente: a sessão é aberta com um acesso e continua servindo depois que o papel foi
revogado ou o módulo cancelado. Sem sessão, revogar tem efeito na chamada seguinte,
igual à API REST.

O custo é real e aceito: uma resolução de acesso por chamada (as mesmas transações que
a API REST já faz) e um objeto `Server` por requisição — barato perto de uma ida ao
banco. Se um dia o gateway precisar de streaming longo ou notificações do servidor,
a decisão volta à mesa junto com um `EventStore` compartilhado.

### 2. Credencial: o access token da própria plataforma, no `Authorization`

O host manda `Authorization: Bearer <access token>` — o mesmo emitido por
`POST /api/v1/auth/login` ou por uma service account. O tenant vem do claim `tid`,
nunca de parâmetro. A cadeia é a mesma do `AccessGuard`:

```
token → tenant (claim) → vínculo e papéis → módulo contratado → permissão da capacidade
```

**OAuth 2.1 e `/.well-known/oauth-protected-resource` ficam fora desta fase.** A
plataforma não é um Authorization Server e virar um é trabalho de fase própria
(registro dinâmico de cliente, consentimento, PKCE, rotação). Enquanto isso, hosts que
sabem carregar um bearer estático conectam hoje; hosts que só fazem descoberta OAuth
não conectam. A resposta 401 já traz `WWW-Authenticate: Bearer`, que é o gancho por
onde a descoberta entra quando for implementada, sem quebrar quem já usa bearer.

### 3. Duas naturezas de falha, deliberadamente separadas

| Situação                                              | Resposta                    |
| ----------------------------------------------------- | --------------------------- |
| Tool inexistente, entrada inválida, permissão negada  | Erro JSON-RPC (`McpError`)  |
| Recusa do domínio (documento duplicado, agenda cheia) | `isError: true` no conteúdo |

A distinção é para o **agente**, não para o log. Erro de protocolo diz "a chamada não
aconteceu" — o modelo não deve tratar o texto como resultado. `isError` diz "aconteceu
e o negócio recusou" — o modelo consegue corrigir a entrada e tentar de novo. Falha
interna nunca vira `isError`: virar texto para o modelo raciocinar em cima seria
convidá-lo a inventar contorno para um bug.

### 4. `packages/platform-core`: a composição sai de `apps/api`

`criarNucleo` e o catálogo de módulos passam a viver em `@ecojotaduo/platform-core`.
Os dois apps (e o worker da Fase 8) chamam a **mesma** função. A alternativa — o
gateway montar sua própria árvore de casos de uso — reintroduziria pela porta dos
fundos a duplicação de regra que o ADR-0001 existe para impedir: bastaria um
adaptador trocado num dos lados para as bordas divergirem em silêncio.

`apps/api` continua dono da sua borda (tokens de DI do Nest, controllers, filtro de
Problem Details); o que saiu foi só a montagem dos módulos de domínio.

### 5. O contrato MCP vive em `packages/mcp-kit`, não nos módulos

`McpToolDefinition`, `McpResourceDefinition`, `McpPromptDefinition` e o `McpCatalog`
ficam num pacote próprio, espelhando o que `http-kit` faz para o REST. Dois motivos:

- nenhum módulo vira dependência de outro só para reusar o tipo de uma tool;
- **nenhum símbolo do SDK MCP entra em `modules/`**. Módulo declara capacidade; quem
  conhece transporte é o gateway. Se a especificação trocar de transporte, só a borda
  muda — que é justamente a promessa do ADR-0004.

O `McpCatalog` recebe o `AccessGrant` em **todo** método: não existe "listar tudo".
Descoberta e execução consultam a mesma função de autorização, então uma tool que não
aparece na listagem também não executa se o host adivinhar o nome.

## Consequências

- Hosts MCP conectam com bearer estático; integração via fluxo OAuth fica pendente.
- Revogação de papel ou de módulo passa a valer na chamada seguinte, sem esperar o
  token expirar — igual ao REST.
- Uma resolução de acesso por chamada MCP (mesma latência da API REST).
- Escritas ainda não têm chave de idempotência: hoje a proteção real é a invariante de
  domínio (documento único por empresa, agenda sem sobreposição). A chave genérica
  entra na Fase 8, junto com retry automático — antes disso ela protegeria contra um
  retry que ninguém faz.

## Riscos

| Risco                                           | Mitigação                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Especificação MCP evoluir                       | SDK oficial + E2E com o cliente oficial no CI, que falha se o handshake mudar    |
| Host que exige descoberta OAuth não conectar    | Declarado aqui; `WWW-Authenticate` já é o ponto de extensão                      |
| Catálogo divergir das permissões dos manifestos | Catálogo recusa a montagem de capacidade sem permissão declarada (teste próprio) |
| Custo por chamada crescer com muitos módulos    | O filtro é O(capacidades); a ida ao banco é que domina — cache entra na Fase 10  |
