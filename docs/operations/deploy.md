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
  acidente que ninguém percebe até a auditoria.

O processo roda como usuário `node`, não root.
