# ADR-0014 — Observabilidade por log estruturado, e limites por credencial

- **Status**: aceito
- **Data**: 2026-08-21

## Problema

A Fase 10 tem um critério de aceite verificável: para **qualquer** requisição,
conseguir responder quem fez, de qual empresa, por qual interface, o que pediu,
quanto tempo levou e qual foi o resultado. E tem um conjunto de controles que a
plataforma ainda não tinha: limite de requisições, cabeçalhos de segurança e
rastro de recusa.

A parte difícil não é ligar as peças, é escolher onde cada informação mora sem
criar duas verdades.

## Decisão

### 1. Duas trilhas, com fronteira clara

| Trilha                     | Responde                                                | Onde                                      |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| Auditoria (`audit_events`) | O que **aconteceu de negócio**, e o que foi **barrado** | Tabela, por empresa, consultável por rota |
| Log de requisição          | O que **passou pela borda** — leitura, erro, latência   | Uma linha JSON por requisição             |

A auditoria é por empresa e sobrevive à rotação de log; ela responde
investigação. O log responde operação: "esta rota, desta empresa, está lenta".

Sobreposição é proposital nas recusas — elas aparecem nas duas. Quem investiga
um padrão de sondagem quer a consulta por empresa; quem está de plantão quer o
`grep`.

### 2. A negação de acesso deixa rastro; a falha de autenticação não

`platform.access.denied` é gravado quando a cadeia recusa por **permissão,
escopo ou módulo não contratado** — os dois lados, REST e MCP, gravam a mesma
ação com a mesma razão. Separar "não contratou" de "não pode" é o que distingue
uma conversa comercial de uma investigação.

Recusa por token, vínculo ou empresa **não** é auditada. Nesses casos ainda não
há empresa autenticada no contexto, e gravar a trilha exigiria escolher um
tenant a partir de um token que pode ser forjado — seria inventar rastro em vez
de registrá-lo. Essas ficam só no log de requisição, sem empresa atribuída.

Falha ao auditar não vira 500: a recusa já aconteceu, e é ela que importa para
quem chamou. O erro vai para o log, sem silêncio.

### 3. O limite é por credencial, não por endereço

Um ERP é usado atrás de NAT corporativo. Um balde por IP puniria a empresa
inteira pelo uso de uma pessoa — e o incidente apareceria como "o sistema caiu"
para quem não fez nada. A chave é o hash da credencial; só quem chega sem
credencial cai no balde do IP.

O login tem balde próprio, por endereço: ali ainda não existe credencial, e é
justamente onde alguém tenta adivinhar uma. Baldes separados porque, com um só,
uso normal consumiria a franquia do login e uma pessoa legítima seria barrada
ao renovar a sessão.

**O contador vive na memória do processo.** A plataforma não tem Redis por
decisão (ADR-0012), e trazê-lo só para contar requisições seria um componente
novo em produção para um problema que ainda não existe. Com N réplicas o teto
efetivo é N vezes maior — o que continua contendo força bruta e agente em laço.
Trocar por um store compartilhado é configuração do plugin, não reescrita.

### 4. O 429 fala a língua de cada borda

Na API sai como Problem Details (RFC 9457), igual a todo erro dela. No gateway
MCP sai como erro JSON-RPC. Em nenhuma das duas vira 500: "o servidor quebrou"
é a informação errada quando o servidor está justamente se protegendo, e o
cliente precisa saber que a resposta certa é esperar, não repetir.

### 5. Cabeçalhos explícitos, não `helmet`

Esta é uma API JSON, não um site. Metade do que um `helmet` configura protege
páginas que aqui não existem. O conjunto que sobra é curto o bastante para
ficar visível no código, com o motivo de cada cabeçalho ao lado — o que também
evita ligar proteção por hábito sem saber contra o quê.

HSTS só em produção: sob HTTP puro o navegador ignora, e em desenvolvimento
atrapalha (uma vez recebido, força HTTPS no domínio inteiro por um ano).

## Consequências

- Toda borda HTTP nova precisa ligar três coisas: contexto, cabeçalhos e log.
  Na API isso está concentrado em `prepararBordaHttp`, chamada também pelos
  testes E2E — se cada um tivesse a própria lista, um plugin novo passaria a
  valer em produção e não no teste, que é a pior das duas ordens.
- O log é JSON, não texto. O destino é um agregador, e formato que precisa de
  expressão regular para virar campo acaba não sendo consultado.
- A rota registrada (`/customers/:customerId`) é o que vai no log, não a URL.
  Com o id dentro, cada requisição viraria uma série de um item só.

## O que ficou fora, e por quê

| Item                              | Motivo                                                                                                                                                                                                            | Quando                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| OpenTelemetry                     | O `correlationId` já atravessa API, gateway e worker (inclusive pelo outbox) e é consultável. OTel só passa a somar quando houver coletor e backend para onde exportar — sem eles, é dependência que não faz nada | Fase 11, junto com a implantação    |
| Dashboards e alertas              | Dependem de um destino de métricas que ainda não existe                                                                                                                                                           | Fase 11                             |
| Teste de carga                    | Sem ambiente parecido com produção, mede a máquina de quem rodou                                                                                                                                                  | Fase 11                             |
| Rotação de `SECRETS_KEY`          | Exige duas chaves ativas ao mesmo tempo e recifragem por empresa                                                                                                                                                  | Quando houver 2º ambiente           |
| Store compartilhado de rate limit | Só passa a importar com múltiplas réplicas                                                                                                                                                                        | Fase 11                             |
| Token anti-CSRF                   | Nenhuma rota de negócio é autenticada por cookie; `sameSite=strict` cobre `refresh` e `logout` (ADR-0011)                                                                                                         | Se alguma rota passar a usar cookie |
