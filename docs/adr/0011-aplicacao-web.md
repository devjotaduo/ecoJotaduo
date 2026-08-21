# ADR-0011 — Aplicação web: só o SDK, sessão na aba, interface não é barreira

- **Status**: aceito
- **Data**: 2026-08-21

## Problema

A plataforma tinha cinco módulos de negócio operáveis por REST, por SDK e por agente
MCP — e nenhuma tela. Construir a primeira traz quatro decisões que valem registro,
porque as próximas telas vão copiá-las.

## Decisão

### 1. React + Vite, consumindo **apenas** `@ecojotaduo/api-client`

Nenhum tipo de API escrito à mão em `apps/web`. Cada rota chamada é uma chave do
`paths` gerado do OpenAPI: mudar um campo no servidor quebra a compilação da tela, e
não a tela em produção. É o que a Fase 4 existia para permitir — a primeira prova de
que o SDK cumpre o que prometeu.

Sem TanStack Query e sem biblioteca de UI. Um hook `useRecurso` de trinta linhas cobre
carregando/erro/recarregar nas seis telas atuais; cache e invalidação seriam
configuração para um problema que ainda não existe. Entram quando uma tela pedir.

### 2. Access token só em memória; refresh token no `sessionStorage`

O access token abre **todas** as rotas, imediatamente, sem nenhuma volta ao servidor.
Fora da memória, um vazamento dele não é detectável nem revogável até expirar. O
refresh token, sozinho, ainda passa pela rotação com detecção de reuso (ADR-0007):
usá-lo duas vezes derruba a família inteira, então o vazamento é detectável.

Por isso a divisão: o access token vive numa variável e some ao recarregar a página; o
refresh vai para o `sessionStorage`, para um F5 não pedir senha de novo, e morre quando
a aba fecha. Depois do reload, o armazenamento devolve access token vazio — o SDK
chama sem credencial, toma 401 e renova. O caminho de restauração é o mesmo de sempre,
sem código especial.

**Isto não protege contra XSS**, e não vamos fingir que protege: script injetado lê
`sessionStorage` do mesmo jeito. A correção durável é cookie `httpOnly` + CSRF, que
exige mudança na API (emitir cookie, validar origem, token anti-CSRF) e está declarada
como dívida no roadmap. O que a decisão atual compra é reduzir o que fica exposto, não
eliminar a exposição.

### 3. A interface esconde; o servidor barra

`pode('crm.customer.create')` some com o botão que só levaria a 403. É espelho da
decisão do servidor, com a mesma regra de curinga e o mesmo recorte de
`plugin.<id>` — e é **conveniência, não segurança**.

O briefing é explícito: nenhuma descrição de ferramenta, interface, agente ou frontend
é barreira de segurança. Se o espelho divergir do servidor, quem está certo é o
servidor: a rota continua protegida, o botão escondido só evita o clique inútil.

### 4. Proxy do Vite em desenvolvimento, não CORS na API

O servidor de dev encaminha `/api` para `127.0.0.1:3000`, então navegador e API ficam
na mesma origem. Abrir CORS na API para acomodar o servidor de dev seria afrouxar o
servidor por conveniência do front — e o afrouxamento costuma sobreviver até produção.
Em produção os dois ficam atrás do mesmo domínio (ou de um proxy), e nada muda no
código.

## Consequências

- Toda mudança de contrato aparece como erro de compilação na tela.
- Fechar a aba encerra a sessão. É escolha, não limitação: "lembrar de mim" entre
  sessões exige o cookie `httpOnly`.
- A tela precisa de duas chamadas ao abrir (`/auth/me` e `/auth/my-tenants`) para
  montar o acesso a partir do servidor — nada de permissão vinda de algo guardado no
  cliente, que o usuário poderia editar.

## O que ficou fora, e por quê

| Item                                 | Motivo                                                              | Quando            |
| ------------------------------------ | ------------------------------------------------------------------- | ----------------- |
| Cookie `httpOnly` + CSRF             | Exige emissão e validação na API                                    | Fase 10           |
| Administração de plugins na tela     | O fluxo tem segredo em trânsito; merece desenho próprio             | Depois da Fase 10 |
| Agenda e notas do CRM completas      | A tela cobre o fluxo principal; agenda entra com o módulo Operações | Fase 7            |
| Biblioteca de UI / design system     | Um aplicativo só; vira pacote quando houver um segundo              | Se houver         |
| Testes de ponta a ponta no navegador | Os E2E de API já cobrem as regras; o que falta é fluxo de tela      | Fase 10           |
