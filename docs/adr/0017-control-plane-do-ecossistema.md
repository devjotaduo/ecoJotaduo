# ADR-0017 — ecoJotaduo como Control Plane do ecossistema JotaDuo

- **Status**: aceito
- **Data**: 2026-08-22

## Problema

O ecossistema JotaDuo em produção — Open WebUI (Studio), OmniRoute, Hermes,
Twenty, GOWA e a ponte de WhatsApp — funciona, atende clientes e **não tem
dono da identidade**. Uma empresa não é uma linha em lugar nenhum: ela é a
coincidência de cinco coisas em cinco sistemas diferentes, amarradas por
convenção de nome (`gid`, `gid8`, `slug`). Provisionar é um script; conferir
se provisionou é outro script; e o modo de falha típico é silencioso — grant
que sumiu, modelo sem tool, atendente respondendo sem base de conhecimento.

Este repositório resolveu exatamente esse problema para o seu próprio domínio:
`tenant_id` + RLS, cadeia de autorização única, outbox transacional, worker
idempotente, auditoria. A pergunta que este ADR responde é se ele deve
resolvê-lo **também para os serviços que já existem** — e a que custo.

A alternativa honesta era reescrever o ecossistema aqui dentro. Ela está
descartada: são serviços em produção, com clientes, e a parte deles que
funciona é justamente a que custaria mais para reproduzir (RAG, roteamento de
LLM com failover, pareamento de WhatsApp, descoberta de capacidades em sistema
sem API).

## Decisão

### 1. O Control Plane é este repositório, com a árvore que ele já tem

`ecoJotaduo` passa a ser a fonte canônica de **quem é a empresa, quem são as
pessoas, o que está contratado, o que foi provisionado e o que foi executado**.
Os serviços atuais continuam donos do **trabalho**: modelo, RAG, canal, CRM,
execução profunda.

A separação em uma frase: **o Control Plane decide e registra; o Data Plane
executa.**

Não há árvore nova. A proposta de reorganizar em `packages/core`, `ports`,
`adapters`, `contracts`, `domain-events` foi **recusada**: ela move a
hexagonal de dentro do módulo para o topo do monorepo, e essas fronteiras já
existem e já reprovam o build (`packages/eslint-config/index.mjs` — domínio
sem infraestrutura, aplicação só falando com portas, ninguém importando
`src/**` alheio). Trocar a árvore seria reescrever o que este ADR existe para
não reescrever, sem regra nova em troca.

### 2. Recurso externo é dado da empresa, não identidade dela

Nasce `external_resources`: uma linha por recurso que existe **fora** desta
plataforma e pertence a uma empresa daqui.

| Coluna        | Papel                                                         |
| ------------- | ------------------------------------------------------------- |
| `tenant_id`   | O dono canônico. RLS como qualquer tabela de negócio          |
| `system`      | `studio`, `omniroute`, `hermes`, `crm`, `whatsapp`            |
| `kind`        | `group`, `service-account`, `api-key`, `profile`, `workspace` |
| `external_id` | O identificador **no sistema de destino**                     |
| `state`       | `pending`, `active`, `failed`, `revoked`                      |

A regra que decide tudo o mais: **`gid8` deixa de ser fronteira de
autorização.** Ele continua existindo em nome de modelo e de perfil, porque é
o que está em produção e renomear não paga — mas como rótulo, não como
credencial. Quem responde "esta requisição é da empresa X" é `tenant_id`, e a
tradução para o identificador externo é uma consulta nesta tabela, com escopo.

Motivo concreto: `gid8` são oito caracteres derivados de um UUID, e a base
inteira já aprendeu o custo de identidade curta — a lista de administradores
do WhatsApp casa por oito dígitos de telefone, e é uma pendência registrada
justamente por isso.

Sem chave estrangeira para tabela de outro módulo, como em todo o resto
(ADR-0016): a extração futura do provisionamento não pode depender de FK.

### 3. Provisionar é evento, nunca requisição HTTP

Criar empresa continua sendo **uma transação**: tenant, pessoa proprietária,
vínculo, módulos contratados, `provisioning_runs` e o fato no outbox. Nada de
serviço externo é chamado dentro do request.

O worker (`apps/worker`) drena e executa cada passo de forma idempotente,
gravando `external_resources` conforme cria. Isso não é infraestrutura nova: é
o outbox da Fase 8 (`for update skip locked`, `available_at`, backoff,
`status = 'dead'`) fazendo o trabalho para o qual foi construído. Nenhum
broker entra aqui — ADR-0012 segue valendo, e a razão dele só se inverte
quando surgir consumidor fora deste processo.

A consequência que importa: **um host reiniciado no meio do provisionamento
continua do ponto seguro**, e é isso que hoje não existe. Um script
interrompido deixa a empresa em estado que ninguém consegue nomear.

O caminho síncrono também não muda de dono: `apps/api/src/cli/provisionar-empresa.ts`
continua sendo o procedimento operado, e passa a enfileirar o provisionamento
externo em vez de terminar sem ele.

### 4. Adaptador é porta no composition root, e o serviço atual não é tocado

Cada sistema do Data Plane entra como uma porta declarada pelo módulo e
adaptada em `packages/platform-core/src/composition.ts` — o mesmo mecanismo
com que o Comercial fala com o CRM hoje, e com que o CRM já é ligável em
processo ou por HTTP (ADR-0016).

Nenhum adaptador entra em `src/domain/**` nem em `src/application/**`; o caso
de uso conhece a porta. A regra de camadas já reprova o contrário, então isso
não é promessa, é lint.

### 5. Espelho antes de origem

Antes de o Control Plane **criar** qualquer empresa, ele **reconhece** as que
existem: importa os tenants atuais e registra os recursos externos já
provisionados, sem alterar o fluxo vivo. Só depois o cadastro passa a nascer
aqui.

Isso não é cautela genérica. É a única forma de descobrir divergência entre o
que a documentação afirma e o que o host tem — e a regra da casa é que, em
caso de divergência, **o host é canônico**. Um espelho que não bate é achado,
não erro do espelho.

### 6. Agente é dado versionado, não código

`Sofia` e `Lia` deixam de ser nomes na estrutura e viram duas instâncias de um
catálogo de templates (`owner_assistant`, `customer_operations`, e os que
vierem). O que uma empresa tem é uma configuração publicada: objetivo,
gatilhos, ferramentas, permissões, alçada de autonomia e a versão que está no
ar.

A propriedade que sustenta isso é a que este repositório já aplica em quatro
módulos: **estado derivável não vira coluna**. "Pronto para o ar" sai dos
testes contra a configuração corrente e do selo do conhecimento — guardado
como coluna, mentiria no instante seguinte a qualquer edição, e um agente
mentindo sobre estar pronto é um agente atendendo cliente com configuração
que ninguém aprovou.

Permissão de ferramenta segue `modulo.recurso.acao`, como todas as outras, e a
autorização de execução é a cadeia única de sempre. Um agente **não** ganha
caminho paralelo de autorização: o `AccessGrant` com que ele age é o mesmo
objeto, com `credential` distinguindo como a requisição se autenticou. É
exatamente a lição do token pessoal — enquanto a conversão de credencial viveu
dentro do guard da API, a credencial valia numa borda e era recusada na outra,
e nenhum teste pegou.

### 7. A estabilização não é deste repositório

Quatro correções do desenho — o fallback da chave restrita do Twenty para a
administrativa, o MCP cru do CRM exposto ao modelo, a allowlist de WhatsApp
por oito dígitos e a redação de segredos em log — vivem em `twenty/`,
`sofia-wa-bridge/` e no host. Elas são **pré-requisito** do Control Plane, não
conteúdo dele: colocar um registro canônico na frente de uma credencial com
fallback administrativo documenta o furo em vez de fechá-lo.

Registrá-las aqui e não executá-las lá seria o modo de falha mais caro desta
casa: documentação plausível e falsa.

## O que foi recusado, e por quê

| Proposta                                                             | Por que não                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createApiNucleus()`, `createMcpNucleus()`, `createWorkerNucleus()`… | O `criarNucleo` é **um** de propósito: cinco montagens divergem em silêncio. Já aconteceu, com o token pessoal, e custou uma borda inteira. Peso de carga se resolve com `src/http.ts` fora do índice (ADR-0015) |
| Árvore `packages/core \| ports \| adapters \| contracts`             | Move a hexagonal para o topo sem regra nova; as três fronteiras já reprovam o build por módulo                                                                                                                   |
| Temporal / Kafka / NATS                                              | ADR-0012. O outbox é a fila. Entram quando houver consumidor fora deste processo, não antes                                                                                                                      |
| `agent-runtime` como app desde já                                    | Runtime sem agente configurado é composition root vazio. Ele nasce quando houver template publicado para executar                                                                                                |
| Identidade por `gid8`                                                | Oito caracteres derivados não são fronteira de segurança — vira compatibilidade visual                                                                                                                           |
| Rota HTTP de criação de empresa                                      | Mesma razão do provisionamento atual: aberta é auto-registro, fechada exige identidade acima de todas as empresas                                                                                                |

## Consequências

**Ganha-se** um lugar onde a pergunta "esta empresa está inteira?" tem
resposta consultável, e um provisionamento que sobrevive a reinício. A
auditoria de quem mandou o quê passa a existir para o ecossistema, não só para
esta plataforma.

**Paga-se** com um segundo lugar onde a empresa é conhecida, enquanto o
espelho não vira origem. Durante essa janela, divergência é possível e precisa
ser detectável — por isso o espelho vem antes, e por isso `state` é coluna de
`external_resources`.

**Fica em aberto**: nada aqui torna o Data Plane menos acoplado a si mesmo. Se
o Studio cair, o atendimento cai — o Control Plane sabe disso, não impede.

## Alternativas consideradas

**Reescrever o ecossistema neste repositório.** Descartada: o que funciona lá
é o caro de reproduzir, e a reescrita substituiria um problema de governança
por um problema de paridade funcional com produção rodando.

**Deixar o Studio ser o Control Plane.** É o estado atual. Falha por duas
razões medidas: o estado crítico vive em SQLite sem RLS, e cadastrar empresa é
edição de banco por script — o que explica por que o modo de falha típico é
silencioso.

**Um serviço de identidade separado, novo.** Seria um terceiro lugar onde a
empresa existe, com a cadeia de autorização a construir do zero. Aqui ela já
está construída, testada contra PostgreSQL real e exercitada em duas bordas.
