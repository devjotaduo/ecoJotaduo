# ADR-0016 — Extração seletiva: o mesmo contrato, dois adaptadores

- **Status**: aceito
- **Data**: 2026-08-21

## Problema

O ADR-0001 escolheu monólito modular com uma promessa explícita: o isolamento
por pacote cria, desde o início, os contratos que uma extração exigiria — de
modo que extrair um módulo seja **"mudança de infraestrutura, não reescrita"**.

Onze fases depois, a promessa nunca tinha sido cobrada. Uma arquitetura que
afirma suportar extração sem nunca ter extraído nada está afirmando uma
hipótese.

## Decisão

### 1. Extrair o CRM, e mantê-lo extraível — não extraído

`apps/crm-service` monta o MESMO `CrmService` sobre o MESMO repositório
Drizzle, e troca apenas a borda: de chamada em processo para HTTP. Não há
código de negócio novo. Se houvesse, a extração seria reescrita.

O CRM foi escolhido porque é o único módulo com consumidor de outro módulo
(`commercial` → `CustomerDirectory` → `CrmPublicApi`), então é onde a fronteira
está sob carga real.

**A extração é ligável, não permanente.** `CRM_SERVICE_URL` ausente: o CRM roda
em processo, como sempre. Presente: o mesmo contrato passa a ser atendido por
HTTP. O padrão continua sendo o monólito — extrair sem necessidade concreta
troca uma chamada de função por um problema distribuído.

### 2. O módulo publica as duas formas de satisfazer o próprio contrato

`@ecojotaduo/crm` exporta `CrmService` (em processo) no índice e `CrmHttpClient`
em `@ecojotaduo/crm/remote`. Quem escolhe é o composition root, numa linha:

```ts
const crmApi: CrmPublicApi = env.CRM_SERVICE_URL
  ? new CrmHttpClient({ baseUrl: env.CRM_SERVICE_URL, emissor: ... })
  : new CrmService(clientesRepo);
```

Essa simetria é o que faz a troca ser configuração. O consumidor
(`CreateProposalUseCase`) continua dependendo de `CustomerDirectory`, a porta
com as palavras dele — e não sabe nem que HTTP existe.

### 3. A fronteira que muda é a de CONFIANÇA, não a de rede

Em processo, `tenantId` chegava como parâmetro de código do mesmo build. Por
HTTP ele chega de fora — e aceitar isso como parâmetro seria abrir um buraco de
multi-tenancy: quem alcançasse a porta escolheria de qual empresa ler.

A empresa viaja no `tid` de um **token assinado**, com:

- **audiência própria** (`ecojotaduo-internal`), verificada — um access token de
  usuário não abre a porta interna, e um token interno não abre a API pública;
- **`kind: 'service'`** exigido — token de usuário é recusado mesmo com a
  audiência certa;
- **vida de 60 segundos** — existe para uma chamada;
- **escopo mínimo** (`crm.customer.read`).

Verificado por falsificação: trocada a verificação por leitura do payload sem
conferir assinatura, dois testes reprovam.

### 4. Indisponibilidade não é "não encontrado"

`findCustomer` devolve `null` quando o cliente não existe. Rede fora, DNS
errado ou tempo esgotado lançam `ServicoDeCrmIndisponivelError`.

A distinção decide uma regra de negócio: devolver `null` numa falha de rede
faria o Comercial recusar uma proposta **dizendo que o cliente não existe**,
quando o que houve foi o serviço cair. Erro de infraestrutura precisa parecer
erro de infraestrutura.

## O que a extração provou (e como)

| Afirmação                       | Prova                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| O contrato não muda             | As MESMAS asserções rodam contra os dois adaptadores (`describe.each`) e dão o mesmo resultado    |
| O banco pode ser outro          | O serviço sobe contra um banco com **só** as tabelas `crm_*`, aplicando só as migrações do módulo |
| Nada trava a separação de dados | Teste consulta `pg_constraint`: nenhuma tabela `crm_*` referencia tabela de outro módulo          |
| O negócio não muda              | O fluxo de proposta funciona com o CRM fora do processo — inclusive as recusas                    |
| A chamada realmente sai         | O serviço conta as requisições recebidas; sem a troca de adaptador o contador fica em zero        |

Esse último ponto merece nota. Como o serviço roda contra o mesmo banco no E2E
da plataforma, em processo e por HTTP dão exatamente a mesma resposta — o teste
passaria mesmo se a chamada nunca saísse do monólito. O contador é o que
transforma "passou" em "passou pela rede".

## Consequências

- **Um segredo compartilhado entre os dois serviços.** O token interno é HS256
  com o mesmo `JWT_SECRET`. Funciona e é simples; um serviço com equipe própria
  pediria chave assimétrica ou mTLS, para que o CRM pudesse verificar sem poder
  emitir.
- **Uma chamada de função virou uma chamada de rede.** Latência, timeout e
  indisponibilidade passam a existir onde não existiam. É o custo real da
  extração, e a razão de ela ser ligável em vez de padrão.
- **A borda REST do CRM continua no monólito.** Numa extração de verdade ela
  iria junto; aqui a fronteira exercitada é a de módulo-para-módulo, que é a
  que a arquitetura prometeu.
- Variável de ambiente vazia passou a valer como ausente. Os modelos
  versionados apresentam as opcionais em branco, e sem isso deixar a linha como
  está derrubava o boot com "Invalid URL".

## O que ficou fora, e por quê

| Item                                      | Motivo                                                                                         | Quando                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- |
| Mover a borda REST/MCP do CRM             | A fronteira que interessa provar é entre módulos; as bordas públicas são cópia do padrão       | Se o CRM for extraído de fato |
| Migração de dados entre bancos            | O teste prova que o esquema é separável; mover linhas é procedimento de operação, não desenho  | Na extração real              |
| Chave assimétrica / mTLS no túnel interno | Segredo compartilhado basta enquanto os dois serviços têm o mesmo dono                         | Com equipe ou repo próprio    |
| Repetição e disjuntor no cliente HTTP     | Uma leitura idempotente com timeout curto; repetir sem necessidade esconde a indisponibilidade | Se a chamada crescer          |
| Extrair um segundo módulo                 | O padrão está provado; repetir sem necessidade concreta é custo sem benefício                  | Com justificativa (ADR-0001)  |
