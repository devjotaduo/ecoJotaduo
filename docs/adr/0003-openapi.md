# ADR-0003 — REST + OpenAPI como contrato de API

- **Status**: aceito
- **Data**: 2026-08-20

## Problema

A mesma plataforma servirá o frontend web interno, aplicativos mobile futuros,
sistemas de terceiros, plugins e automações determinísticas. É necessário um contrato
estável, versionado, com SDK gerado e detecção de breaking changes.

## Alternativas consideradas

1. **GraphQL** — flexível para clientes, porém complica autorização por campo,
   caching HTTP e integrações B2B tradicionais.
2. **tRPC** — excelente DX interna TypeScript, mas não serve terceiros nem gera
   contrato neutro.
3. **REST + OpenAPI** — contrato neutro, tooling maduro, ideal para integrações e
   geração de SDK.

## Decisão

Adotar **REST + OpenAPI** (alternativa 3):

- Prefixo versionado `/api/v1`; `operationId` estável e único; DTOs validados em
  runtime; erros padronizados (RFC 9457 – Problem Details); paginação, filtros e
  ordenação convencionados; idempotência via `Idempotency-Key` em mutações críticas.
- O documento OpenAPI é **gerado a partir do código** (`@nestjs/swagger` 11.4.x) no
  CI; breaking changes são detectados por diff de contrato antes do merge.
- **Versão do formato**: OpenAPI **3.0**, que é o formato emitido nativamente pela
  cadeia escolhida (@nestjs/swagger) e aceito por todos os geradores/validadores do
  pipeline. Migraremos para 3.1 quando toda a cadeia (emissor, diff, gerador de SDK)
  a suportar de ponta a ponta — decisão a reavaliar na Fase 4.
- SDK TypeScript gerado em `packages/api-client`, único ponto de consumo HTTP do
  frontend (cliente central com auth, renovação de token, correlação, tratamento de
  erro, retries seguros). A escolha da ferramenta de geração será registrada em ADR
  próprio na Fase 4.

## Benefícios

- Terceiros integram sem SDK proprietário; webhooks e OAuth se encaixam naturalmente.
- Contrato único elimina tipos duplicados entre API e frontend.
- Diff de contrato no CI transforma breaking change em evento explícito e versionado.

## Riscos

- Verbosidade de decorators/DTOs — aceita; é o custo do contrato explícito.
- Divergência contrato × comportamento — mitigada por geração a partir do código e
  testes de contrato.

## Impacto da migração

GraphQL ou tRPC poderiam ser adicionados futuramente como *camadas adicionais* sobre
os mesmos casos de uso, sem tocar domínio ou aplicação.
