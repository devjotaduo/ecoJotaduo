# ADR-0015 — Implantação: uma imagem por serviço, migração como passo, um domínio

- **Status**: aceito
- **Data**: 2026-08-21

## Problema

Até a Fase 10 a plataforma nunca tinha sido empacotada. Havia um documento de
visão (`deployment.md`, da Fase 0) descrevendo VM única com Compose, réplicas e
Redis — mas nenhum Dockerfile, e portanto nenhuma prova de que qualquer coisa
ali fosse verdade.

Documento de implantação que ninguém executou é hipótese com formatação de
plano.

## Decisão

### 1. Um Dockerfile para os três serviços Node

`api`, `mcp-gateway` e `worker` saem do mesmo arquivo, escolhidos por
`--build-arg APP=`. Três arquivos quase idênticos divergiriam no primeiro
ajuste, e como as etapas de dependência e compilação são as mesmas, o cache de
camadas passa a ser compartilhado em vez de refeito três vezes.

A web fica à parte (`Dockerfile.web`): o resultado é outro tipo de coisa —
arquivos estáticos, sem processo Node em produção.

### 2. A migração é um serviço, não um passo de boot

Se cada réplica migrasse ao subir, um deploy com N réplicas dispararia N
migrações concorrentes, e um rollback de imagem tentaria migrar para trás — e
migrações aqui são imutáveis, sem `down`.

O serviço `migrate` roda uma vez, com a conexão do **dono** das tabelas, e os
demais só sobem com `condition: service_completed_successfully`. É também o
único lugar do compose que recebe `DATABASE_ADMIN_URL`: a aplicação conecta
com o papel restrito, senão a RLS deixa de valer (ADR-0007).

### 3. Tudo atrás do mesmo domínio, com TLS obrigatório

Tela, `/api` e `/mcp` no mesmo endereço, servidos por um Caddy que também emite
o certificado. Não é arrumação: o refresh token vive num cookie
`SameSite=Strict` + `Secure` (ADR-0011). Domínios diferentes fariam o navegador
não enviá-lo; HTTP puro faria descartá-lo. Nos dois casos a sessão morre a cada
recarregamento **sem erro nenhum em lugar nenhum** — o pior modo de falhar.

### 4. Sem `dumb-init`, e sem Redis

Dois itens que o hábito manda incluir e que foram medidos antes de decidir:

- **`dumb-init`** existe para o caso de um processo PID 1 que ignora SIGTERM.
  Os três apps registram handler explícito; medido, o container para em ~1s com
  e sem o wrapper. E nenhum deles cria processos filhos, então não há zumbi
  para colher.
- **Redis** aparecia no documento de visão da Fase 0 e nunca foi usado: o
  outbox É a fila (ADR-0012) e o rate limit conta em memória (ADR-0014).
  Deixá-lo no compose seria um serviço em produção para ninguém.

### 5. O CI constrói as imagens e sobe a pilha

Dockerfile que só é exercitado no deploy quebra exatamente na hora em que se
precisa dele. O job novo constrói as quatro imagens (sem publicar), sobe o
compose de produção e confere que a tela responde e que as duas bordas pedem
autenticação.

Isso não é zelo abstrato: foi um teste desses que pegou o defeito abaixo.

## O que a primeira tentativa de subir revelou

**O worker não subia.** `Cannot find module 'reflect-metadata'`, na cadeia
`worker → platform-core → @ecojotaduo/assets → assets.controller → http-kit →
@nestjs/common`.

O `index.ts` de cada módulo reexportava os controllers REST. Quem importasse o
pacote — inclusive o worker, que não serve HTTP — carregava NestJS inteiro em
tempo de `require`. O worker morria por falta de um peer do Nest que ele não
tem por que ter.

A correção não foi adicionar a dependência. Foi tirar a borda REST do `index`
e colocá-la num subcaminho (`@ecojotaduo/<mod>/http`), que só o `apps/api`
importa. Isso torna real uma fronteira que a documentação já afirmava: o módulo
declara a borda, o composition root monta.

Nenhum teste unitário ou E2E pegaria isso — todos rodam num processo que já
tem o Nest carregado. Só empacotar e subir revela.

## Consequências

- Módulo novo com borda REST precisa de `src/http.ts` e da entrada `./http` no
  `exports` do `package.json`. Esquecer não quebra o `apps/api` (ele importaria
  do índice), mas volta a arrastar Nest para o worker.
- A política `minimumReleaseAge` do pnpm (recusa pacote publicado nas últimas
  24h) é desligada **dentro do build da imagem**. Ela protege a resolução; uma
  imagem de lockfile congelado não resolve nada, e mantê-la faria o build
  falhar conforme a hora do dia.
- Com N réplicas, o teto de rate limit passa a ser N vezes o configurado.
  Documentado em `deploy.md`; resolver de verdade exige store compartilhado.

## O que ficou fora, e por quê

| Item                              | Motivo                                                                                 | Quando                      |
| --------------------------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| Kubernetes                        | Uma VM com Compose atende o MVP; os manifestos seriam mantidos sem ninguém rodando     | Quando uma VM não bastar    |
| Publicação de imagem (registry)   | Não há ambiente de destino ainda; o CI constrói para provar, não para distribuir       | Junto com o primeiro deploy |
| OpenTelemetry                     | Agora existe onde rodar um coletor, mas ainda não existe backend para onde exportar    | Quando houver o backend     |
| Teste de carga                    | Faz sentido contra a pilha empacotada, não contra `pnpm dev`. A pilha existe agora     | Próxima fase                |
| Store compartilhado de rate limit | Exige Redis ou tabela; só passa a importar quando as réplicas forem permanentes        | Com réplicas fixas          |
| Backup automatizado               | O procedimento manual está no runbook; agendar exige decidir onde guardar (fora da VM) | Junto com o primeiro deploy |
