# Imagem dos serviços Node do monorepo: api, mcp-gateway e worker.
#
# Um Dockerfile só, escolhido por `--build-arg APP=...`. Três arquivos quase
# idênticos divergiriam no primeiro ajuste — e, como as etapas de dependência
# e de compilação são as mesmas para os três, o cache de camadas do Docker é
# compartilhado entre as três imagens em vez de refeito para cada uma.
#
#   docker build -f docker/Dockerfile --build-arg APP=api          -t ecojotaduo/api .
#   docker build -f docker/Dockerfile --build-arg APP=mcp-gateway  -t ecojotaduo/mcp-gateway .
#   docker build -f docker/Dockerfile --build-arg APP=worker       -t ecojotaduo/worker .
#
# O contexto é a RAIZ do repositório: um monorepo pnpm precisa do lockfile e
# dos manifestos de todos os pacotes para resolver o que quer que seja.

# ---------------------------------------------------------------------------
# Base — Node e pnpm, na mesma versão que o repositório declara
# ---------------------------------------------------------------------------
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Sem TTY o pnpm interrompe operações que pedem confirmação, e diz textualmente
# para definir isto. E é verdade: aqui é build automatizado.
ENV CI=true
# `corepack` instala a versão exata do campo `packageManager`: a imagem não
# pode usar um pnpm diferente do que gerou o lockfile.
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Dependências e compilação
# ---------------------------------------------------------------------------
FROM base AS build
COPY . .

# Três escolhas nesta linha:
#
# `--mount=type=cache` guarda o store do pnpm entre builds. É daí que vem o
# ganho de tempo — não da ordem dos COPY. A separação clássica (manifestos
# antes do código, com `pnpm fetch`) esbarra num monorepo de 30 pacotes:
# seriam dezenas de COPY que quebram ao nascer um pacote novo, e o `fetch`
# deixa buracos que o `--offline` depois recusa. Camada invalidada com store
# quente custa segundos.
#
# `minimumReleaseAge=0` desliga a recusa de pacotes publicados nas últimas 24
# horas. Essa política protege a RESOLUÇÃO — o momento em que alguém adiciona
# uma dependência e poderia puxar uma versão recém-publicada e comprometida.
# Uma imagem construída de lockfile congelado não resolve nada: as versões já
# foram decididas e passaram pelo CI. Mantê-la aqui faria o build falhar
# conforme a hora do dia, e deploy que depende da hora é loteria.
#
# `--frozen-lockfile`: lockfile defasado derruba o build, em vez de instalar
# em silêncio versão diferente da que passou no CI.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --config.minimumReleaseAge=0 install --frozen-lockfile

# turbo constrói o grafo inteiro, respeitando as dependências entre pacotes.
RUN pnpm build

# `pnpm deploy` monta um diretório autocontido do app escolhido: só as
# dependências de produção, com os pacotes de workspace copiados para dentro
# em vez de ligados por symlink (que não sobreviveria à cópia entre estágios).
ARG APP
RUN test -n "$APP" || (echo 'defina --build-arg APP=api|mcp-gateway|worker' && false)
RUN pnpm --filter "@ecojotaduo/${APP}" deploy --legacy --prod /saida

# ---------------------------------------------------------------------------
# Execução — sem pnpm, sem código-fonte, sem dependência de desenvolvimento
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Sem `dumb-init`, e isso é deliberado — o hábito diz para colocar.
#
# O "problema do PID 1" é que um processo nessa posição não ganha os handlers
# PADRÃO de sinal, então um Node que ignorasse SIGTERM ficaria de pé até o
# SIGKILL. Os três apps daqui registram handler explícito e drenam o pool
# antes de sair; medido, o container para em ~1s com e sem o wrapper. O outro
# argumento do `dumb-init` — colher processos zumbis — não se aplica: nenhum
# destes processos cria filhos.

COPY --from=build --chown=node:node /saida ./

# Não roda como root: um container comprometido não deve poder mais do que o
# processo precisa.
USER node

# Documentação apenas; a porta real vem de PORT / MCP_PORT.
EXPOSE 3000 3001

CMD ["node", "--enable-source-maps", "dist/main.js"]
