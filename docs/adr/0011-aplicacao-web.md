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

### 2. Nada de sessão fica ao alcance de script (revisto na Fase 10)

O access token abre **todas** as rotas, imediatamente, sem nenhuma volta ao servidor.
Fora da memória, um vazamento dele não é detectável nem revogável até expirar. Ele
vive numa variável e some ao recarregar a página.

O refresh token **não passa pelo JavaScript**: a API o devolve num cookie `httpOnly`,
`sameSite=strict`, com `path` limitado a `/api/v1/auth`. O navegador o envia sozinho e
nenhum script o enxerga — nem o nosso. Depois de um F5 não há access token, o SDK
chama sem credencial, toma 401 e renova pelo cookie: o caminho de restauração é o
mesmo de antes, sem código especial.

**Por que não existe token de CSRF junto.** Nenhuma rota de negócio é autenticada por
cookie: o access token vai como `Bearer`, então um POST forjado de outro site chega
sem autorização nenhuma. O único endpoint que lê o cookie é `/auth/refresh`, e
`sameSite=strict` mais o `path` restrito bastam para que uma requisição de outro site
não o carregue. Um token anti-CSRF fecharia uma porta que já não abre, ao custo de
mais uma peça para manter em sincronia entre servidor, SDK e tela.

**O que mudou de fato:** até a Fase 9 o refresh ia no corpo da resposta e a tela o
guardava no `sessionStorage`, de onde um script injetado o lia. Agora um XSS consegue
agir **enquanto a página está aberta** — o que nenhuma dessas medidas impede — mas não
leva a sessão embora.

**Consequência de implantação:** a aplicação web e a API precisam ser _same-site_ em
produção. Em desenvolvimento o proxy do Vite já garante a mesma origem (decisão 4).

**Sair virou operação de servidor.** A tela não consegue apagar um cookie `httpOnly`,
então existe `POST /api/v1/auth/logout`: ele limpa o cookie e revoga a família de
refresh tokens — sair numa aba vale nas outras, e num equipamento perdido também.

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
- A sessão sobrevive a fechar e reabrir a aba, dentro da validade do refresh token: o
  cookie não é de sessão do navegador. Encerrar de verdade exige `logout`.
- A tela precisa de duas chamadas ao abrir (`/auth/me` e `/auth/my-tenants`) para
  montar o acesso a partir do servidor — nada de permissão vinda de algo guardado no
  cliente, que o usuário poderia editar.

## O que ficou fora, e por quê

| Item                                 | Motivo                                                                          | Quando                       |
| ------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------- |
| Refresh token para cliente nativo    | O fluxo de senha hoje é só de navegador; um app nativo precisaria dele no corpo | Quando existir um app nativo |
| Administração de plugins na tela     | O fluxo tem segredo em trânsito; merece desenho próprio                         | Depois da Fase 10            |
| Agenda e notas do CRM completas      | A tela cobre o fluxo principal; agenda entra com o módulo Operações             | Fase 7                       |
| Biblioteca de UI / design system     | Um aplicativo só; vira pacote quando houver um segundo                          | Se houver                    |
| Testes de ponta a ponta no navegador | Os E2E de API já cobrem as regras; o que falta é fluxo de tela                  | Fase 10                      |
