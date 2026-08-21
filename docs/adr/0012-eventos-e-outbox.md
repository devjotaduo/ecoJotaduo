# ADR-0012 — Eventos: outbox transacional, o outbox como fila, e sem broker

- **Status**: aceito
- **Data**: 2026-08-21

## Problema

Vinte e quatro eventos declarados em manifestos e nenhum publicado. Enquanto
ficaram só declarados, a plataforma não tinha como fazer nada acontecer depois
de um fato de negócio — nem avisar um webhook, nem alimentar um módulo vizinho.

O critério da fase é específico: **falha temporária de integração não desfaz
transação nem derruba API**. Isso descarta a solução mais simples (chamar a
integração dentro do caso de uso) e obriga a decidir onde o evento fica no
intervalo entre "aconteceu" e "foi entregue".

## Decisão

### 1. Outbox transacional, com uma unidade de trabalho de verdade

O evento é gravado na **mesma transação** do dado que o originou. É a única
forma de o outbox significar alguma coisa: com duas transações, um processo
derrubado no meio publica um fato que não aconteceu, ou esquece um que
aconteceu — e as duas falhas são silenciosas.

Isso exigiu algo que o projeto não tinha: uma transação compartilhada por
várias escritas. `comUnidadeDeTrabalho(db, escopo, fn)` abre a transação e a
registra num `AsyncLocalStorage`; o `withTenant` de sempre passa a **reusá-la**
quando já está dentro de uma.

A alternativa era passar `tx` por parâmetro até o fundo, mudando a assinatura de
todos os repositórios de todos os módulos. O reuso por contexto entrega a mesma
garantia sem tocar em nenhum deles — e quem não precisa de atomicidade continua
funcionando exatamente como antes.

Uma unidade pertence a **uma empresa**: `withTenant` com outro tenant lá dentro
lança `EscopoCruzadoError`. A transação carrega `app.tenant_id` fixado no
`set_config`; reusá-la para outra empresa é defeito, e defeito precisa falhar
alto.

### 2. O outbox É a fila — sem broker, sem BullMQ

O roadmap previa BullMQ. Não foi usado, e o motivo é que ele **acrescentaria um
segundo lugar onde a mensagem pode estar**.

O padrão outbox → broker existe quando o broker é o destino real: outro serviço,
outra linguagem, outro time. Aqui os consumidores rodam no mesmo processo. Mover
a mensagem do PostgreSQL para o Redis criaria a janela clássica — está nos dois,
ou em nenhum — em troca de nada que o PostgreSQL não faça:

| Precisa de       | Como                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| Concorrência     | `for update skip locked` — vários workers dividem a fila sem combinar |
| Retry com espera | coluna `available_at`: a linha diz quando volta a ser elegível        |
| Backoff          | exponencial com teto, calculado no adiamento                          |
| DLQ              | `status = 'dead'` depois de N tentativas                              |
| Replay           | `reviver()` devolve o evento morto para `pending`                     |

BullMQ (ou um broker de verdade) entra quando aparecer o primeiro consumidor
**fora deste processo**, ou o primeiro job que não é evento — um cron, um
agendamento. Enquanto não houver, é infraestrutura para um problema inexistente.

### 3. Como o worker enxerga todas as empresas sem furar a RLS

O dispatcher precisa varrer o outbox de todo mundo, e a RLS — corretamente — não
deixa. As duas saídas óbvias são ruins: conectar como dono desliga a RLS para
tudo, e afrouxar a policy transforma o isolamento em decoração.

A saída escolhida é uma função `security definer`:

```sql
create function platform_outbox_pending_tenants(limite integer) returns setof uuid
```

Ela roda com o privilégio do dono, mas devolve **exclusivamente `tenant_id` de
quem tem evento pendente**. Nenhum payload, nenhum tipo, nenhuma contagem. O
dispatcher entra em cada empresa por `withTenant`, e daí para frente a RLS vale
integralmente, como em qualquer outra consulta.

`set search_path = pg_catalog, public` é obrigatório: sem ele, quem pudesse
criar um schema à frente do `public` sequestraria a resolução de nomes dentro de
uma função que roda como dono.

### 4. At-least-once, com registro por handler

Um evento pode chegar duas vezes ao mesmo handler se o processo morrer entre
causar o efeito e registrar a entrega. **Handler idempotente é requisito**, não
recomendação.

O que o registro por handler (`delivered_to text[]`) resolve é o caso comum: com
dois handlers e uma falha em um deles, o retry não reexecuta quem já deu certo.
Sem isso, um consumidor estável seria punido pela instabilidade do vizinho.

### 5. O handler roda como sistema, na empresa do evento

O dispatcher recria o contexto: mesma empresa, mesma correlação da requisição
original, canal `job`, ator `system`. O handler age com os poderes da plataforma
**dentro daquela empresa** — e não com os de quem originou o fato, que pode já
ter tido o acesso revogado.

## Consequências

- Um caso de uso que publica evento precisa de `UnitOfWork` e `EventPublisher`.
  Os cinco módulos verticais foram convertidos; os 19 eventos declarados que
  faziam sentido publicar agora são publicados de verdade.
- A dívida de Operações (reservar equipamento e gravar a locação em duas
  transações, com compensação) **fechou**: as duas caem na mesma unidade.
- A auditoria entrou nas unidades. Trilha de algo que deu rollback vira ruído, e
  falha de auditoria agora derruba a operação — o que é o comportamento certo
  numa plataforma multi-tenant.
- O worker é o terceiro composition root, e monta o mesmo `criarNucleo`.
- Um evento nunca é apagado: entregue ou morto, fica como histórico do que a
  plataforma publicou. A limpeza é rotina de retenção, não do caminho quente.

## O que ficou fora, e por quê

| Item                                    | Motivo                                                                        | Quando                       |
| --------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| BullMQ / broker externo                 | O outbox já é a fila; um broker é um segundo lugar onde a mensagem pode estar | Ao surgir consumidor externo |
| Chave de idempotência na entrada da API | A proteção hoje é a invariante de domínio; não há retry automático de cliente | Fase 10                      |
| Circuit breaker por destino             | O backoff exponencial já contém um destino instável                           | Se um destino justificar     |
| Rate limit de saída                     | Mesma razão: nada, hoje, gera volume que precise                              | Fase 10, com o de entrada    |
| Consumo de evento entre módulos         | Nenhum módulo precisa hoje; o primeiro consumidor real é um plugin            | Quando um pedir              |
| Retenção / expurgo do outbox            | Sem volume que justifique; apagar cedo perde histórico                        | Fase 11                      |
| Ordenação estrita por agregado          | Nenhum handler atual depende de ordem                                         | Quando um depender           |
