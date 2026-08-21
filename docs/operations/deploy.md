# Implantação

Uma VM, Docker Compose, um domínio. É o suficiente para a plataforma inteira —
API, gateway MCP, worker, tela e banco — e o desenho já suporta réplicas sem
mudança de código.

Procedimentos de incidente e de backup ficam em [runbooks.md](runbooks.md).

## As quatro imagens

| Imagem                   | O que é               | Dockerfile              |
| ------------------------ | --------------------- | ----------------------- |
| `ecojotaduo/api`         | REST + OpenAPI        | `docker/Dockerfile`     |
| `ecojotaduo/mcp-gateway` | Gateway MCP           | `docker/Dockerfile`     |
| `ecojotaduo/worker`      | Dispatcher do outbox  | `docker/Dockerfile`     |
| `ecojotaduo/web`         | Tela estática + Caddy | `docker/Dockerfile.web` |

As três primeiras saem do MESMO Dockerfile, escolhidas por `--build-arg APP=`.
As etapas de dependência e compilação são idênticas, então o cache de camadas
é compartilhado em vez de refeito três vezes.

```bash
docker build -f docker/Dockerfile --build-arg APP=api -t ecojotaduo/api:$(git rev-parse --short HEAD) .
```

O contexto é a **raiz** do repositório: um monorepo pnpm precisa do lockfile e
dos manifestos de todos os pacotes.

## Primeira subida

```bash
cp docker/producao.env.example docker/.env.prod
# preencha: SITE_ADDRESS, senhas do banco, JWT_SECRET, SECRETS_KEY
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d --build
```

O que acontece, nesta ordem: o PostgreSQL sobe e fica saudável → o serviço
`migrate` aplica as migrações e sai → API, gateway e worker sobem → o Caddy
publica o domínio e emite o certificado.

Confira:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod ps
curl -sf https://seu-dominio/ && echo "a tela responde"
```

Os endpoints de saúde (`/health`, `/health/ready`) **não passam pelo proxy**,
de propósito: quem os consulta é o orquestrador, pela rede interna. Expô-los
daria a qualquer um um jeito barato de sondar a disponibilidade. Para vê-los:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  exec api node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>r.text()).then(console.log)"
```

## A primeira empresa

A pilha no ar não tem empresa nenhuma, e sem uma o login não tem a quem
responder. Criar a primeira é um **procedimento operado**:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod   run --rm migrate node dist/cli/provisionar-empresa.js   --slug=minha-empresa --nome="Minha Empresa Ltda" --email=voce@minhaempresa.com.br
```

Roda pelo serviço `migrate`, e não por `exec api`, porque a conexão do dono do
banco existe só ali — os apps conectam com o papel restrito, que é o que faz a
RLS valer. Não é obstáculo: é a propriedade funcionando.

A saída traz o id da empresa, os módulos contratados e **a senha, uma vez**.
Guarde-a antes de fechar o terminal: não existe rota que a mostre depois, pelo
mesmo motivo do token pessoal — guardar para mostrar depois é guardar em claro.

Não há parâmetro para informar a senha. Argumento de linha de comando fica no
histórico do shell e aparece em `ps` para qualquer processo da máquina.

| Opção                      | Efeito                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `--slug`                   | O que a pessoa digita no login. Obrigatório                 |
| `--email`                  | A primeira pessoa, que entra como proprietária. Obrigatório |
| `--nome`                   | Nome de exibição da empresa (padrão: o slug)                |
| `--modulos=crm,commercial` | Recorte contratado (padrão: todos os desta instalação)      |

**Rodar de novo é seguro**, e é assim que se contrata um módulo que passou a
existir numa versão nova: a empresa não é recriada e a senha de quem já entrava
não muda. Se o e-mail já tem conta na plataforma, ela ganha vínculo com a
empresa nova e continua com a mesma senha — é assim que uma pessoa atende duas
empresas. Daí em diante, contratar e cancelar módulo é rota autenticada
(`/api/v1/modules`), no escopo de quem está logado.

### Por que não existe rota para criar empresa

Uma rota teria de responder quem pode chamá-la, e as duas respostas disponíveis
são ruins. Aberta, vira auto-registro — decisão de produto que ninguém tomou.
Fechada, exigiria uma identidade com poder sobre todas as empresas, que é
exatamente o que `tenant_id` + RLS existem para tornar impossível. Quem roda o
comando já tem a conexão do dono na mão; não há privilégio novo a inventar.

## Deploy de uma versão nova

```bash
TAG=$(git rev-parse --short HEAD)
for app in api mcp-gateway worker; do
  docker build -f docker/Dockerfile --build-arg APP=$app -t ecojotaduo/$app:$TAG .
done
docker build -f docker/Dockerfile.web -t ecojotaduo/web:$TAG .

# TAG=<sha> em docker/.env.prod, e então:
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d
```

**Use um tag imutável, nunca `latest`.** Com `latest`, "reiniciar o serviço"
pode trocar a versão sem ninguém ter pedido — e o incidente seguinte começa com
a pergunta errada.

### Por que a migração é um serviço à parte

Nunca no boot da réplica. Se cada uma migrasse ao subir:

- um deploy com N réplicas dispararia N migrações concorrentes;
- um rollback de imagem tentaria migrar para trás — e migrações aqui são
  imutáveis, sem `down`.

O serviço `migrate` roda uma vez, com a conexão do **dono** das tabelas, e as
outras só sobem depois (`condition: service_completed_successfully`).

### Migrações compatíveis para trás (expand/contract)

Durante um rolling deploy, código velho e código novo falam com o **mesmo**
banco por alguns segundos. Uma migração que remove ou renomeia coluna derruba
as réplicas antigas antes de elas saírem.

A regra é dividir em dois deploys:

1. **Expand** — adiciona coluna nova (anulável ou com default), escreve nos
   dois lugares. Código velho ignora o que não conhece.
2. **Contract** — no deploy seguinte, quando nenhuma réplica antiga resta,
   remove a coluna velha.

## Réplicas

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod up -d --scale api=3
```

Funciona sem ajuste porque API e gateway são **sem estado** entre requisições
(ADR-0009): o acesso é resolvido do banco a cada chamada, e não guardado em
memória de sessão. Verificado: a mesma sessão atravessa três réplicas, e a
renovação por cookie também.

Duas coisas mudam de comportamento com N réplicas:

- **Rate limiting.** O contador vive na memória de cada processo (ADR-0014), e
  o teto efetivo passa a ser N vezes o configurado. Divida `RATE_LIMIT_MAX`
  pelo número de réplicas, ou aceite o teto maior conscientemente.
- **Worker.** Pode ter réplicas: o outbox usa `for update skip locked`, então
  duas instâncias dividem a fila sem combinar nada. A entrega continua
  at-least-once — o handler é que precisa ser idempotente.

## HTTPS não é opcional

O refresh token vai num cookie com o atributo `Secure` quando
`NODE_ENV=production`. Sob HTTP puro o navegador **descarta o cookie sem
avisar**, e a sessão morre a cada recarregamento sem erro nenhum em lugar
nenhum — o pior modo de falhar.

O Caddy resolve isso emitindo certificado automaticamente a partir de
`SITE_ADDRESS`. Duas condições:

- o domínio precisa apontar para a VM antes da primeira subida;
- o volume `caddydata` precisa persistir, senão cada reinício pede certificado
  novo e esbarra no limite de emissão do Let's Encrypt.

Para experimentar localmente sem DNS, use `CADDY_EXTRA_GLOBAL=local_certs`.

## Tudo no mesmo domínio

Tela, API (`/api`) e gateway MCP (`/mcp`) ficam atrás do mesmo endereço. Não é
arrumação: o cookie de sessão é `SameSite=Strict` (ADR-0011), e domínios
diferentes fariam o navegador não enviá-lo.

## O que a imagem não contém

- **Segredos.** `.env*` está no `.dockerignore`. Tudo vem por variável de
  ambiente, no momento de subir.
- **Código-fonte e dependências de desenvolvimento.** O estágio final recebe só
  o resultado de `pnpm deploy --prod`.
- **`seed:dev`.** O comando existe na imagem mas se recusa a rodar com
  `NODE_ENV=production` — semear dados de exemplo em produção é o tipo de
  acidente que ninguém percebe até a auditoria. Em produção o comando é
  `provisionar-empresa.js`, que gera senha forte em vez de usar uma fixa; o
  provisionamento em si é o mesmo código, para que o caminho de produção não
  seja um que ninguém exercita.

O processo roda como usuário `node`, não root.

## Extrair o CRM (opcional — ADR-0016)

O CRM pode rodar como processo próprio, atendendo o mesmo contrato. **Não é o
padrão**: extrair sem necessidade concreta troca uma chamada de função por um
problema distribuído (latência, timeout, indisponibilidade). O ADR-0001 lista o
que conta como justificativa — escala divergente, isolamento de falha,
requisito regulatório, equipe própria, ciclo de deploy próprio.

O procedimento tem três passos, e a ordem importa:

```bash
# 1. Sobe o serviço. Ninguém fala com ele ainda.
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile crm-extraido up -d

# 2. Confirme que ele atende, pela rede interna.
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  exec crm-service node -e "fetch('http://127.0.0.1:3002/health/ready').then(r=>r.text()).then(console.log)"

# 3. SÓ ENTÃO aponte a plataforma para ele:
#    CRM_SERVICE_URL=http://crm-service:3002  em docker/.env.prod
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod \
  --profile crm-extraido up -d
```

Separar "subir" de "usar" é o que permite observar o serviço antes de depender
dele. E voltar atrás é apagar a variável — o CRM volta a rodar em processo, sem
migração nem deploy especial.

### Banco próprio (passo seguinte, opcional)

`CRM_DATABASE_URL` aponta o serviço para outro banco. Funciona porque nenhuma
tabela `crm_*` tem chave estrangeira para fora do módulo — há teste travando
essa propriedade. Mover os dados é procedimento de operação:

```bash
pg_dump "$ADMIN" --format=custom --table='crm_*' --file=crm.dump
createdb -T template0 ecojotaduo_crm
pg_restore --dbname=ecojotaduo_crm --no-owner crm.dump
# e o papel restrito precisa de grant no banco novo — ver runbooks.md
```

**Enquanto os dois bancos existirem, um deles está desatualizado.** Faça o
corte com a escrita do CRM parada, ou aceite a janela conscientemente.

### O que a fronteira nova exige

A plataforma chama o serviço com token assinado de audiência interna
(`ecojotaduo-internal`), vida de 60 segundos, e a empresa no `tid` — nunca por
parâmetro. Os dois processos compartilham `JWT_SECRET`, então **eles precisam
receber o mesmo valor**. Um serviço com equipe própria pediria chave
assimétrica; enquanto o dono é o mesmo, segredo compartilhado basta.

A porta do serviço **não é publicada**: só a rede interna do compose alcança.
