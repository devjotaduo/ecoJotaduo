# Roadmap de implementação

Fases estritamente ordenadas; cada fase termina com lint + typecheck + testes + build
executados de verdade, documentação atualizada e riscos declarados. Nenhum módulo é
"pronto" com apenas tabela e CRUD.

| Fase                                      | Objetivo                              | Entregáveis-chave                                                                                                                                                                             | Critério de aceite                                                                                   | Riscos principais                                |
| ----------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **0. Descoberta e arquitetura** ✅        | Fronteiras e decisões antes de código | Diagramas C4, mapa de módulos, threat model, ADRs 1–6, roadmap                                                                                                                                | Implementação não inicia sem fronteiras registradas                                                  | Análise infinita — timebox                       |
| **1. Fundação do monorepo**               | Estrutura técnica sem domínio         | pnpm + Turborepo, TS strict, ESLint 10, Prettier, Vitest, env validada, Docker Compose (PG+Redis), health check, CI, regras de dependência                                                    | `pnpm install/lint/typecheck/test/build` verdes                                                      | Bikeshedding de tooling                          |
| **2. Identidade, tenant e permissões** ✅ | Fundação de segurança                 | tenants, orgs, users, memberships, roles, permissions, entitlements, RequestContext, audit log, RLS + papel restrito, auth de usuário e de aplicação, testes de isolamento                    | Usuário do tenant A não acessa nada do tenant B — verificado por suíte E2E contra PostgreSQL real    | Complexidade de RBAC/ABAC — começar mínimo       |
| **3. Primeiro fluxo vertical (CRM)** ✅   | Ponta a ponta real                    | Clientes, notas e agendamentos: domínio com invariantes, use cases, Drizzle + RLS, REST no módulo, 7 tools MCP, auditoria, testes unit/integração/E2E (tela React adiada)                     | REST e MCP executam exatamente os mesmos use cases — verificado em teste                             | Escopo crescer — escopo mínimo acordado          |
| **4. OpenAPI e SDK** ✅                   | Contrato como produto                 | OpenAPI 3.1 gerado dos schemas Zod, deriva barrada no CI, SDK tipado com sessão e renovação, docs de versionamento e depreciação                                                              | Consumidor usa só o SDK gerado, zero tipos manuais — verificado em E2E                               | Detecção semântica de breaking change pendente   |
| **5. MCP Gateway** ✅                     | Capacidades para agentes              | `apps/mcp-gateway` com Streamable HTTP sem sessão, `packages/mcp-kit` (contrato + catálogo autorizado), 7 tools, 2 resources, 1 prompt, auditoria, E2E com o cliente oficial, docs de conexão | Host autorizado descobre e executa apenas as capacidades do seu tenant — verificado em E2E           | Fluxo OAuth 2.1 do MCP ainda não implementado    |
| **6. Module Registry e Plugin SDK** ✅    | Extensão controlada                   | `packages/plugin-sdk` (manifesto validado + runtime), `modules/plugins` (catálogo, instalação por empresa, segredos cifrados, health), plugin `notifications-example` com REST e MCP          | Ativar/desativar plugin em uma empresa não afeta outras — verificado em E2E                          | Plugin externo (out-of-process) ainda não existe |
| **7. Expansão dos módulos**               | Verticais de negócio                  | Ordem: Commercial → Contracts → Assets → Operations → Billing → Finance → Inventory → Maintenance → RH; cada um com domínio, REST, MCP, eventos, UI, testes, auditoria                        | Cada módulo entrega ao menos um fluxo de negócio completo                                            | Módulos rasos em paralelo — um vertical por vez  |
| **8. Eventos, integrações e jobs** ✅     | Confiabilidade assíncrona             | Outbox + dispatcher, BullMQ, retries, idempotência, DLQ, webhooks assinados, replay, circuit breaker, rate limit                                                                              | Falha temporária de integração não desfaz transação nem derruba API                                  | Semântica de retry mal definida                  |
| **9. MCP Apps e UIs de plugin** ✅        | Interfaces interativas                | App exemplo (form + dashboard), CSP, sandbox, validação de mensagens, fallback textual                                                                                                        | Host sem suporte a Apps continua usando a tool estruturada                                           | Depender de host específico                      |
| **10. Observabilidade e segurança**       | Confiança operacional                 | OTel completo, dashboards, alertas, auditoria consultável, rate limiting, headers, secret management, backup/restore testado, runbooks, carga                                                 | Responder: quem, qual tenant, qual interface, qual use case, quanto tempo, resultado, correlation ID | Instrumentação tardia — base já na Fase 1        |
| **11. Implantação e escala**              | Escala horizontal                     | Imagens Docker, staging/prod, migrations controladas, readiness, graceful shutdown, zero-downtime, deploy independente api/mcp/worker                                                         | API e MCP escalam sem estado local                                                                   | Migrations incompatíveis — expand/contract       |
| **12. Extração seletiva**                 | Processo, não execução                | Contratos estáveis → eventos versionados → testes de contrato → novo deployable → adapter remoto → migração de dados → cutover                                                                | Extração sem mudanças relevantes nos consumidores                                                    | Extrair sem justificativa concreta               |

### Fase 3 — escopo entregue

Escopo reduzido a pedido: **clientes, notas e agendamentos** (o cliente é o
substrato de que notas e agenda dependem). Entregue com domínio, casos de uso,
persistência com RLS, REST, contribuição MCP, auditoria e testes.

Ficou **fora** desta entrega, deliberadamente:

| Item                          | Por quê                                                | Quando                     |
| ----------------------------- | ------------------------------------------------------ | -------------------------- |
| Tela React (`apps/web`)       | O pedido foi de recursos mínimos; o SDK já está pronto | ✅ entregue após a Fase 7  |
| Gateway MCP rodando           | As tools existem e são testadas; falta o transporte    | ✅ entregue na Fase 5      |
| Eventos publicados via outbox | Declarados no manifesto, ainda não emitidos            | Fase 8                     |
| Reagendar (mudar horário)     | Cancelar + agendar cobre o caso                        | Quando houver demanda real |
| Arquivar cliente por rota     | A regra existe no domínio, sem endpoint                | Quando houver demanda real |

## Sequência imediata

1. ✅ Fase 0 — arquitetura, diagramas C4 e ADRs.
2. ✅ Fase 1 — fundação do monorepo (lint, typecheck, testes, build, Docker, CI).
3. ✅ Fase 2 — identidade, tenant, permissões, auditoria e isolamento testado.
4. ✅ Fase 3 — CRM mínimo (clientes, notas, agendamentos), com REST e a
   contribuição MCP chamando exatamente os mesmos casos de uso.
5. ✅ Fase 4 — OpenAPI 3.1 gerado do código, SDK tipado em `packages/api-client`,
   deriva de contrato barrada no CI.
6. ✅ Fase 5 — Gateway MCP: transporte Streamable HTTP sem sessão, catálogo filtrado
   por empresa, papéis e módulo contratado, resources e prompt do CRM.
7. ✅ Fase 6 — Registry de plugins: instalação por empresa, segredos cifrados,
   permissões concedidas na instalação e o primeiro plugin first-party de verdade.
8. **Fase 7 (em andamento)** — Expansão dos módulos, um vertical por vez.
   ✅ **Commercial** (propostas: elaborar → enviar → decidir).
   ✅ **Contracts** (formalizar da proposta aceita → ativar → encerrar).
   ✅ **Assets** (cadastrar → bloquear por período → liberar → baixar).
   ✅ **Operations** (programar sob contrato → retirar → devolver → cancelar).
   Os demais verticais (Billing, Finance, Inventory, Maintenance, RH) foram
   **pulados a pedido**: os quatro entregues já provam o padrão de módulo e a
   comunicação entre eles.
9. ✅ Fase 8 — Outbox transacional, unidade de trabalho, dispatcher com retry,
   backoff, DLQ e replay; `apps/worker` como terceiro composition root.
10. ✅ Fase 9 — MCP Apps: contrato de interface no `mcp-kit`, documento
    montado pelo gateway com CSP fechada e runtime embutido, painel do pátio
    como exemplo.
11. ✅ Fase 10 — Observabilidade e segurança: dívidas de transação e corrida
    pagas, negação de acesso auditada nas duas bordas, limite de requisições
    por credencial, refresh token em cookie `httpOnly`, cabeçalhos de
    segurança, log estruturado por requisição e runbooks.
12. ✅ Fase 11 — Implantação: quatro imagens, compose de produção com Caddy,
    migração como passo explícito de deploy, e o CI construindo e subindo a
    pilha.
13. ✅ Fase 12 — Extração seletiva: o CRM roda como processo próprio, com banco
    próprio, atendendo o MESMO contrato. Ligável por `CRM_SERVICE_URL`; o
    padrão continua sendo o monólito.

### Fase 5 — escopo entregue

`apps/mcp-gateway` monta o MESMO núcleo da API REST (`criarNucleo`, agora em
`packages/platform-core`) e liga só a borda. O catálogo (`McpCatalog`) recebe o
`AccessGrant` em todo método: descoberta e execução passam pela mesma decisão, então
uma tool que não aparece na listagem também não executa se o host adivinhar o nome.

Ficou **fora** desta entrega, deliberadamente:

| Item                                   | Por quê                                                                    | Quando                  |
| -------------------------------------- | -------------------------------------------------------------------------- | ----------------------- |
| Fluxo OAuth 2.1 do MCP                 | A plataforma não é Authorization Server; bearer próprio conecta hoje       | Fase própria (ADR-0009) |
| Chave de idempotência em escritas      | A proteção real hoje é a invariante de domínio; sem retry automático ainda | Fase 8                  |
| Federação de servidores MCP de plugins | O MCP local precisa estar estável primeiro (ADR-0004)                      | Fase 6+                 |
| MCP Apps (UI interativa)               | Depende do catálogo estável                                                | Fase 9                  |
| `outputSchema` / `structuredContent`   | Exigiria schema de saída por tool, com risco de deriva, sem consumidor     | Quando um host pedir    |
| `stdio` para dev                       | O host de teste é HTTP; um segundo transporte sem uso é peso morto         | Se aparecer demanda     |

### Fase 6 — escopo entregue

Um plugin habilitado vira **entitlement** (`plugin.<id>`), então rota REST e tool MCP
passam a enxergá-lo sem código novo em nenhuma das bordas (ADR-0010). O plugin age com
a interseção entre o que a instalação concedeu e os módulos ainda contratados — nunca
com os poderes de quem o chamou.

Ficou **fora** desta entrega, deliberadamente:

| Item                                   | Por quê                                                                       | Quando                |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------- |
| Plugin Gateway (plugins externos)      | Nenhum plugin externo existe; o manifesto já distingue `remote`               | Quando houver um      |
| `manifest.schema.json` versionado      | O Zod já valida; o JSON só serve a autor externo                              | Idem                  |
| Feature flags genéricas                | Habilitar/desabilitar plugin cobre o caso; o risco da fase é generalizar cedo | Quando houver 2º caso |
| Migrações próprias de plugin           | O plugin de exemplo não tem tabelas                                           | Quando um pedir       |
| Assinatura de eventos (`subscribesTo`) | Não há barramento; o manifesto já recusa evento inexistente                   | Fase 8                |
| UI de plugin                           | Depende de `apps/web`                                                         | Fase 9                |

### Fase 7 — Commercial (primeiro vertical)

Escopo mínimo com fluxo fechado: proposta para um cliente do CRM, com itens em
centavos, envio (que congela os valores) e decisão do cliente. Cinco tools MCP sobre
os mesmos casos de uso do REST, incluindo `commercial.proposal.approve` — a intenção
de negócio que o modelo MCP cita como exemplo.

Duas escolhas de desenho que valem registro:

- **`expired` é derivado, não guardado.** Se fosse coluna, dependeria de um job rodar
  para virar verdade, e uma proposta vencida ficaria "enviada" até lá. Derivando de
  `validUntil`, ela vence no instante certo, sem agendador.
- **Número por empresa vem de contador atômico**, não de `max(number) + 1`: duas
  criações simultâneas leriam o mesmo máximo. Há teste com cinco criações em paralelo.

Ficou **fora**, deliberadamente:

| Item                                      | Por quê                                                                 | Quando                |
| ----------------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| Dependência de Catalog (item de catálogo) | Catalog não existe; no escopo mínimo o item é descrito à mão            | Quando Catalog vier   |
| Versionamento de proposta (revisões)      | Recusar alteração após o envio já protege o combinado                   | Quando houver demanda |
| PDF da proposta                           | Depende de Documents, transversal ainda não implementado                | Fase 9+               |
| Eventos publicados                        | Declarados no manifesto, sem barramento até a Fase 8                    | Fase 8                |
| Desconto no cabeçalho da proposta         | Desconto por item cobre o caso; total no cabeçalho duplicaria a verdade | Se pedirem            |

### Fase 7 — Contracts (segundo vertical)

Um contrato nasce de uma proposta **aceita**: cliente, título, moeda e valor vêm dela,
e não de quem formaliza — se viessem, o contrato poderia divergir do que o cliente
aceitou e a proposta deixaria de significar alguma coisa. Uma proposta vira um
contrato só (regra no caso de uso, restrição de unicidade no banco como rede de baixo).

`expired` segue o padrão do Comercial: derivado de `endsOn`, nunca guardado. Encerrar
formalmente um contrato de vigência vencida continua sendo operação válida — é assim
que a situação deixa de ser `expired` e vira `finished`.

A ligação com o Comercial é por **chamada direta ao caso de uso**, via superfície
pública. O barramento de eventos entra na Fase 8, onde a durabilidade é o ponto; até
lá, chamada direta é honesta e não esconde o acoplamento.

Ficou **fora**, deliberadamente:

| Item                            | Por quê                                                     | Quando                      |
| ------------------------------- | ----------------------------------------------------------- | --------------------------- |
| Renovação / aditivo de contrato | Encerrar e formalizar um novo cobre o caso no escopo mínimo | Quando houver demanda       |
| Reajuste por índice             | Depende de Finance                                          | Fase 7, com Finance         |
| Contrato sem proposta (avulso)  | Contradiz a regra que define o módulo                       | Se o negócio pedir, com ADR |
| Anexos (documento assinado)     | Depende de Documents, transversal ainda não implementado    | Fase 9+                     |
| Eventos publicados              | Declarados no manifesto, sem barramento até a Fase 8        | Fase 8                      |

### Fase 7 — Assets (terceiro vertical)

O fluxo fechado é o **ciclo de disponibilidade do equipamento**: cadastrar no
patrimônio, bloquear por um período com motivo, liberar (inclusive antes do
previsto) e dar baixa definitiva. É o que Operações e Manutenção vão consumir
nas próximas entregas.

Duas escolhas de desenho que valem registro:

- **Disponibilidade não é coluna.** O ativo guarda só `active` ou `retired`;
  "disponível" e "bloqueado" saem dos bloqueios sobre ele no instante
  consultado. A mesma linha do banco responde "livre hoje" e "ocupada dia 15"
  sem nenhuma rotina rodar no meio — é o mesmo princípio de `expired` no
  Comercial, agora aplicado a um estado que muda várias vezes por semana.
  O filtro por disponibilidade acontece no **banco**, e não depois de paginar:
  filtrado em memória, uma página de 20 devolveria menos de 20 e o total
  mentiria.

- **A sobreposição é impedida pelo banco**, com `exclude using gist` sobre
  `tstzrange` (extensão `btree_gist`). O caso de uso confere antes de gravar,
  mas verificação em aplicação tem janela: duas reservas simultâneas leem
  "livre" e as duas gravam — e o conflito aparece no dia da entrega, com dois
  clientes esperando a mesma máquina. É a mesma corrida que a numeração de
  propostas evita com contador atômico.

  O período que conta é o **efetivo**, encurtado pela liberação:
  `greatest(starts_at, coalesce(released_at, ends_at))`. O `greatest` cobre
  cancelar um compromisso que ainda não começou — sem ele o intervalo ficaria
  invertido e o PostgreSQL recusaria a linha com erro de faixa, virando 500 numa
  operação legítima. Há teste para exatamente esse caso.

Permissões separadas de propósito: quem opera o pátio (`assets.asset.hold`) não
cadastra patrimônio (`manage`) nem dá baixa (`retire`). O mapa de módulos previa
`read`/`manage`; o fluxo real pediu quatro, e a alçada tem teste E2E.

Ficou **fora**, deliberadamente:

| Item                                        | Por quê                                                                            | Quando                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| Bloqueio sem previsão de término            | Período fechado sustenta a restrição de exclusão; liberar antecipado cobre o caso  | Se a operação pedir    |
| Vínculo do bloqueio com contrato/locação    | Operações é quem tem esse conceito; aqui o bloqueio é só motivo + período          | Fase 7, com Operations |
| Telemetria / horímetro                      | Depende de integração com equipamento; nada consome hoje                           | Quando houver fonte    |
| Depreciação e valor contábil                | É assunto de Finance, não de disponibilidade                                       | Fase 7, com Finance    |
| Hierarquia de ativos (implemento, conjunto) | Um nível cobre o escopo mínimo; a árvore complica toda consulta de disponibilidade | Quando houver demanda  |
| Eventos publicados                          | Declarados no manifesto, sem barramento até a Fase 8                               | Fase 8                 |

### Fase 7 — Operations (quarto vertical)

O elo que fecha a fase: a locação nasce de um **contrato em vigor** e **reserva o
equipamento no patrimônio**. É o primeiro módulo que depende de dois outros, e o
primeiro que ESCREVE em outro módulo.

Três escolhas de desenho que valem registro:

- **Operações não sabe se um equipamento está livre.** Não existe coluna
  "locado" aqui: programar uma locação chama `AssetsPublicApi.reserve(...)`, e a
  garantia contra locação dupla passa a ser a restrição de exclusão que já
  existia em Ativos. Verificado por falsificação: neutralizada a reserva, a
  segunda locação no mesmo período passa com 201 em vez de 409.

- **A locação cabe dentro da vigência do contrato.** Equipamento na rua fora da
  vigência não tem o que o cubra — nem comercialmente, nem em caso de sinistro.
  Cliente e período vêm do contrato, não de quem programa.

- **`overdue` é derivado de `endsAt`**, seguindo `expired` do Comercial e de
  Contratos. Uma locação em andamento com prazo vencido está atrasada no
  instante em que passa, e é disso que sai cobrança extra. `diasDeAtraso()` é
  calculado antes de encerrar, porque depois a situação vira `finished` e o
  número se perderia.

**Escrita entre módulos passa pelos casos de uso do dono**, e não pelo
repositório dele: a recusa de equipamento comprometido e a auditoria do bloqueio
ficam num lugar só, valendo igual para quem chama pelo REST, pela tool MCP ou de
outro módulo.

Ficou **fora**, deliberadamente:

| Item                                    | Por quê                                                                 | Quando                |
| --------------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| Apontamento de operação (horímetro, km) | Depende de telemetria ou de coleta em campo; nada consome hoje          | Quando houver fonte   |
| Cobrança do atraso                      | `overdueDays` já sai pronto na leitura; quem fatura é Billing           | Fase 7, com Billing   |
| Agenda/roteirização de entrega e coleta | É outro problema (rotas, motoristas); locação fechada não depende disso | Quando houver demanda |
| Troca de equipamento na mesma locação   | Encerrar e programar outra cobre o caso, e mantém o histórico honesto   | Se a operação pedir   |
| Eventos publicados                      | Declarados no manifesto, sem barramento até a Fase 8                    | Fase 8                |

**Dívida assumida — e paga na Fase 8:** reservar no patrimônio e gravar a
locação eram duas transações, com compensação se a gravação falhasse.
Compensação que também falha deixa o equipamento bloqueado sem nenhuma locação
que explique o bloqueio. Com a unidade de trabalho (ADR-0012), as duas caem
juntas e a compensação deixou de ser necessária.

### `apps/web` — primeira tela (ADR-0011)

Entregue junto do segundo vertical: login, carteira de clientes com linha do tempo,
funil de propostas (criar → enviar → decidir) e contratos (formalizar → ativar →
encerrar). Consome **apenas** o SDK gerado — nenhum tipo de API escrito à mão.

O pátio de equipamentos entrou junto com o terceiro vertical, com o filtro de
disponibilidade por data — a tela que torna visível que a situação é derivada. As
locações entraram com o quarto, mostrando os dias de atraso na própria lista.

### Fase 8 — eventos, outbox e worker (ADR-0012)

Vinte e quatro eventos estavam declarados em manifesto e nenhum era publicado.
Agora os cinco módulos verticais publicam de verdade, e o fato de negócio chega
a um consumidor sem que a API espere por ele.

Quatro decisões que valem registro:

- **O evento vai na MESMA transação do dado.** Foi preciso criar uma unidade de
  trabalho de verdade: `comUnidadeDeTrabalho` abre a transação e a registra num
  `AsyncLocalStorage`, e o `withTenant` de sempre a reusa quando já está dentro
  de uma. Nenhum repositório mudou de assinatura. Verificado por falsificação:
  removido o reuso, exatamente os testes de atomicidade quebram — e o sintoma é
  o outbox guardando um fato que o banco desfez.

- **O outbox é a fila; não há broker.** O roadmap previa BullMQ, e ele não foi
  usado: com consumidores no mesmo processo, um broker seria um segundo lugar
  onde a mensagem pode estar. `for update skip locked`, `available_at`, backoff
  exponencial e `status = 'dead'` cobrem concorrência, retry, espera e DLQ.
  BullMQ entra quando aparecer consumidor fora deste processo ou job que não
  seja evento.

- **O worker enxerga todas as empresas sem furar a RLS.** Uma função
  `security definer` devolve apenas o `tenant_id` de quem tem pendência —
  nenhum payload. O dispatcher entra em cada empresa por `withTenant`, e daí em
  diante a RLS vale integralmente.

- **At-least-once, com registro por handler.** Handler idempotente é requisito.
  O `delivered_to` evita o caso comum: com dois consumidores e falha em um, o
  retry não repete quem já deu certo.

A dívida de Operações fechou junto: reservar o equipamento e gravar a locação
eram duas transações com compensação, e agora caem na mesma unidade.

Ficou **fora**, deliberadamente (detalhe no ADR-0012):

| Item                                    | Por quê                                                             | Quando                       |
| --------------------------------------- | ------------------------------------------------------------------- | ---------------------------- |
| BullMQ / broker externo                 | O outbox já é a fila; broker seria um segundo lugar para a mensagem | Ao surgir consumidor externo |
| Chave de idempotência na entrada da API | Sem retry automático de cliente hoje                                | Fase 11                      |
| Circuit breaker e rate limit de saída   | O backoff já contém um destino instável                             | Fase 11                      |
| Consumo de evento entre módulos         | Nenhum precisa hoje; o primeiro consumidor real é um plugin         | Quando um pedir              |
| Retenção / expurgo do outbox            | Sem volume que justifique; apagar cedo perde histórico              | Fase 11                      |
| Ordenação estrita por agregado          | Nenhum handler depende de ordem                                     | Quando um depender           |

### Fase 9 — MCP Apps (ADR-0013)

O risco que o próprio roadmap registrou para esta fase era **depender de host
específico**. A resposta está no critério de aceite, e ele virou o primeiro
bloco do E2E: a tool devolve o resultado de sempre em `content`, e um host sem
suporte a Apps não perde nada.

Três decisões:

- **A interface é sugestão, não requisito.** Ela desenha o `structuredContent`
  que a tool já devolveu — não busca nada por conta própria, porque duas
  leituras seriam duas verdades. E `_meta` só aparece quando o app está no
  recorte da empresa: sugerir uma tela que o host não conseguiria ler daria
  erro na cara de quem usa.

- **O módulo declara o corpo; o gateway monta o documento.** Markup, estilo e
  script vêm do módulo; a Content-Security-Policy e o runtime do protocolo são
  do gateway. Nenhum símbolo do SDK MCP entrou em `modules/` (ADR-0004 segue
  valendo), e a CSP não depende de o autor do módulo lembrar dela —
  `default-src 'none'`, e `connect-src` só abre com `connectDomains` declarado.

- **App é capacidade, e reautoriza na leitura.** `acharApp` exige as permissões
  como `acharTool` faz. Verificado por falsificação: sem isso, uma empresa sem
  o módulo lê a interface adivinhando a URI. App sem permissão declarada e tool
  apontando para app inexistente falham na **montagem** do catálogo.

Ficou **fora**, deliberadamente (detalhe no ADR-0013):

| Item                                 | Por quê                                                                | Quando                   |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------ |
| App que chama tools de volta         | O painel se basta com o que recebe; chamar de volta é outra superfície | Quando um app precisar   |
| `updateModelContext` a partir do app | Deixa o app influenciar o que o modelo lê                              | Junto com o item acima   |
| App de plugin (third-party)          | O contrato já serve; falta o primeiro que peça                         | Quando um pedir          |
| Framework de UI no documento         | O painel é uma lista; framework aqui é peso morto                      | Se um app ficar complexo |
| Teste em navegador de verdade        | O E2E cobre montagem, CSP e autorização                                | Fase 11                  |

### Fase 10 — Observabilidade e segurança (ADR-0014)

A primeira fase que não construiu capacidade nova: pagou o que estava anotado.
O item mais antigo esperava desde a Fase 3.

**Dívidas pagas**

| Dívida                                            | Como                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Resolver acesso abria 5 transações por requisição | Envolvido na unidade de trabalho da Fase 8 — nenhum repositório mudou de assinatura                           |
| Rotação de refresh token não era atômica          | Revoga antes de emitir, com `revoked_at is null` no próprio `UPDATE`: o banco escolhe a vencedora             |
| Negação de acesso não deixava rastro              | `platform.access.denied` nas duas bordas, com a razão (`entitlement` / `permission` / `scope`)                |
| Sem rate limiting                                 | `@fastify/rate-limit` nas duas bordas, com balde por credencial e balde separado para o login                 |
| Refresh token no `sessionStorage`                 | Cookie `httpOnly` + `sameSite=strict` + `path` restrito; `POST /auth/logout` passou a existir por necessidade |

**Achado de brinde.** A instabilidade do teste de backoff do outbox não era do
teste: o `lote()` comparava `available_at` (escrito pelo banco) com
`new Date()` (relógio do processo). Um worker com relógio adiantado pegaria o
evento antes da hora; atrasado, o deixaria parado. Seleção e adiamento passaram
a usar `now()` do banco.

**Correção de rumo.** A unidade de trabalho ganhou uma proteção que foi
retirada no mesmo dia: um erro alto quando a consulta pedia escopo de usuário
numa unidade sem ele. Ela quebrou 61 testes por um problema que este código não
tem — a policy do outbox nem lê `app.user_id`. Ficou o comportamento certo, que
é **refixar** o escopo: dentro da unidade a consulta responde igual a fora, sem
cerimônia em nenhum ponto de chamada.

**Critério de aceite.** Para qualquer requisição é possível responder quem fez,
de qual empresa, por qual interface, o quê, quanto tempo e com que resultado —
pela trilha de auditoria (ações de negócio e recusas) e por uma linha JSON de
log por requisição (o resto: leitura, erro, latência).

**Também entrou:** cabeçalhos de segurança explícitos nas duas bordas (HSTS só
em produção), `docs/operations/runbooks.md` com os procedimentos de incidente e
o de backup/restauração — incluindo a verificação obrigatória de que a RLS
sobreviveu à restauração.

Ficou **fora**, deliberadamente (detalhe no ADR-0014):

| Item                              | Por quê                                                                                                                                        | Quando                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| OpenTelemetry                     | O `correlationId` já atravessa API, gateway e worker (inclusive pelo outbox) e é consultável. OTel só soma com coletor e backend para exportar | Fase 11                 |
| Dashboards e alertas              | Dependem de um destino de métricas que ainda não existe                                                                                        | Fase 11                 |
| Teste de carga                    | Sem ambiente parecido com produção, mede a máquina de quem rodou                                                                               | Fase 11                 |
| Store compartilhado de rate limit | Só passa a importar com múltiplas réplicas                                                                                                     | Fase 11                 |
| Rotação de `SECRETS_KEY`          | Exige duas chaves ativas ao mesmo tempo e recifragem por empresa                                                                               | 2º ambiente             |
| Token anti-CSRF                   | Nenhuma rota de negócio é autenticada por cookie (ADR-0011)                                                                                    | Se alguma passar a usar |

### Fase 11 — Implantação (ADR-0015)

Até aqui existia um documento de visão da Fase 0 descrevendo VM única com
Compose — e nenhum Dockerfile. Documento de implantação que ninguém executou é
hipótese com formatação de plano.

**O que passou a existir**

| Peça                             | O que faz                                                            |
| -------------------------------- | -------------------------------------------------------------------- |
| `docker/Dockerfile`              | Uma imagem para `api`, `mcp-gateway` e `worker` (`--build-arg APP=`) |
| `docker/Dockerfile.web`          | Build do Vite + Caddy servindo os estáticos                          |
| `docker/Caddyfile`               | Proxy: `/` → tela, `/api` → API, `/mcp` → gateway; TLS automático    |
| `docker/docker-compose.prod.yml` | A pilha, com `migrate` como serviço que roda antes das réplicas      |
| `docs/operations/deploy.md`      | Primeira subida, deploy de versão, réplicas, expand/contract         |
| Job `imagens` no CI              | Constrói as quatro e sobe a pilha inteira a cada PR                  |

**Verificado de verdade**, não por leitura: as quatro imagens constroem, a
migração aplica as 11 migrações e sai, os cinco serviços ficam saudáveis, e o
fluxo completo passa pelo proxy — login com cookie, renovação, detecção de
reuso, saída, criação de cliente e o worker drenando o outbox até `delivered`.
Com `--scale api=3`, a mesma sessão atravessa as três réplicas.

**O defeito que só o empacotamento revelou.** O worker não subia:
`Cannot find module 'reflect-metadata'`. O `index.ts` de cada módulo
reexportava os controllers REST, então qualquer importador — inclusive o
worker, que não serve HTTP — carregava NestJS inteiro em tempo de `require`.

A correção não foi adicionar a dependência: foi mover a borda REST para um
subcaminho (`@ecojotaduo/<mod>/http`) que só o `apps/api` importa. Isso torna
real uma fronteira que a documentação já afirmava. **Nenhum teste unitário ou
E2E pegaria isso** — todos rodam num processo que já tem o Nest carregado.

**Duas coisas que o hábito manda incluir e foram medidas antes:** `dumb-init`
(o container para em ~1s com e sem ele, porque os apps tratam SIGTERM) e Redis
(estava no documento de visão e nunca foi usado — o outbox é a fila, o rate
limit conta em memória).

Ficou **fora**, com motivo no ADR-0015:

| Item                              | Por quê                                                                              | Quando                   |
| --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------ |
| Kubernetes                        | Uma VM com Compose atende o MVP; manifestos ficariam sem ninguém rodando             | Quando uma VM não bastar |
| Publicação em registry            | Não há ambiente de destino; o CI constrói para provar, não para distribuir           | Com o primeiro deploy    |
| OpenTelemetry                     | Já existe onde rodar coletor, mas ainda não há backend para onde exportar            | Com o backend            |
| Teste de carga                    | Faz sentido contra a pilha empacotada — que passou a existir agora                   | Fase 12                  |
| Store compartilhado de rate limit | Só importa com réplicas permanentes                                                  | Com réplicas fixas       |
| Backup automatizado               | O procedimento manual está no runbook; agendar exige decidir onde guardar fora da VM | Com o primeiro deploy    |

### Fase 12 — Extração seletiva (ADR-0016)

O ADR-0001 prometeu, na primeira fase, que extrair um módulo seria "mudança de
infraestrutura, não reescrita". Esta fase cobra a promessa.

**O que passou a existir**

| Peça                             | O que é                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| `apps/crm-service`               | O MESMO `CrmService`, servido por HTTP em processo próprio        |
| `@ecojotaduo/crm/remote`         | `CrmHttpClient` — a outra forma de satisfazer `CrmPublicApi`      |
| `CRM_SERVICE_URL`                | Ausente: em processo. Presente: por HTTP. Uma linha na composição |
| Perfil `crm-extraido` no compose | O serviço sobe sem que ninguém fale com ele, até você mandar      |

**O que foi provado, e como**

| Afirmação               | Prova                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| O contrato não muda     | As mesmas asserções contra os dois adaptadores (`describe.each`), com o mesmo resultado |
| O banco pode ser outro  | O serviço sobe contra um banco com **só** as tabelas `crm_*`                            |
| Nada trava a separação  | Teste em `pg_constraint`: nenhuma tabela `crm_*` referencia tabela de outro módulo      |
| O negócio não muda      | O fluxo de proposta funciona com o CRM fora do processo, inclusive as recusas           |
| A chamada realmente sai | O serviço conta as requisições; sem a troca de adaptador o contador fica em zero        |

Esse último ponto foi o que quase escapou: como o serviço roda contra o mesmo
banco no E2E da plataforma, em processo e por HTTP dão a MESMA resposta — o
teste passaria mesmo se a chamada nunca saísse do monólito. O contador é o que
transforma "passou" em "passou pela rede".

**A fronteira que muda é a de confiança.** Em processo, `tenantId` vinha de
código do mesmo build. Por HTTP ele chega de fora, e aceitá-lo como parâmetro
seria abrir um buraco de multi-tenancy. A empresa viaja no `tid` de um token
assinado, com audiência própria (`ecojotaduo-internal`), `kind: service`
exigido, vida de 60 segundos e escopo mínimo. Falsificado: sem a verificação,
dois testes reprovam.

**Achado de brinde:** variável de ambiente vazia derrubava o boot. Os modelos
versionados apresentam as opcionais em branco, e `CRM_SERVICE_URL=` fazia o
`z.url()` recusar com "Invalid URL" — verdadeiro e inútil. Vazio passou a valer
como ausente; obrigatória vazia continua falhando alto.

Ficou **fora**, com motivo no ADR-0016:

| Item                             | Por quê                                                                                  | Quando                        |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------- |
| Mover a borda REST/MCP do CRM    | A fronteira que interessa provar é entre módulos; as bordas públicas são cópia do padrão | Se o CRM for extraído de fato |
| Migração de dados entre bancos   | O teste prova que o esquema é separável; mover linhas é operação, não desenho            | Na extração real              |
| Chave assimétrica / mTLS         | Segredo compartilhado basta enquanto os dois serviços têm o mesmo dono                   | Com equipe ou repo próprio    |
| Repetição e disjuntor no cliente | Leitura idempotente com timeout curto; repetir esconde a indisponibilidade               | Se a chamada crescer          |
| Extrair um segundo módulo        | O padrão está provado; repetir sem necessidade é custo sem benefício                     | Com justificativa (ADR-0001)  |

### Dívidas conhecidas ao fim da Fase 2

| Item                                                                      | Impacto                                  | Quando resolver                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| ~~Resolver o acesso abre **5** transações por requisição~~                | —                                        | ✅ Fase 10 — uma transação só, pela unidade de trabalho         |
| ABAC ainda é só o gancho de política (só RBAC + escopos estão em uso)     | Regras de alçada por valor não existem   | Fase 7, com Comercial/Financeiro                                |
| ~~Sem rate limiting no login~~                                            | —                                        | ✅ Fase 10 — balde próprio, por endereço                        |
| ~~Rotação de refresh token não é atômica~~                                | —                                        | ✅ Fase 10 — revoga antes de emitir, condição no próprio UPDATE |
| Sem cache — a regra de segmentação por tenant existe, mas não tem sujeito | Nenhum                                   | Ao introduzir o primeiro cache                                  |
| ~~Negação de acesso não é auditada~~                                      | —                                        | ✅ Fase 10 — `platform.access.denied` nas duas bordas           |
| ~~Sem rate limiting por credencial no gateway MCP~~                       | —                                        | ✅ Fase 10                                                      |
| Webhook de plugin: janela de DNS rebinding entre resolver e conectar      | SSRF residual em cenário elaborado       | Ao introduzir camada de saída controlada (Fase 11)              |
| `SECRETS_KEY` não tem rotação                                             | Trocar a chave hoje invalida os segredos | Quando houver o segundo ambiente de produção                    |
