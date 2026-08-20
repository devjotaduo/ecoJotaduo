# ADR-0008 — OpenAPI 3.1 e geração do SDK

- **Status**: aceito
- **Data**: 2026-08-20
- **Substitui**: a escolha de versão do [ADR-0003](0003-openapi.md) (3.0 → 3.1)

## Problema

O ADR-0003 fixou OpenAPI **3.0** com a justificativa explícita de que era "o
formato emitido nativamente pela cadeia escolhida", e deixou registrado:
"migraremos para 3.1 quando toda a cadeia a suportar de ponta a ponta — decisão
a reavaliar na Fase 4". Chegou a Fase 4, e além da versão era preciso decidir
como gerar o SDK.

Havia ainda um atrito concreto: os DTOs da plataforma são **schemas Zod**, não
classes decoradas, que é o que o `@nestjs/swagger` documenta por padrão.

## Verificação feita

| Elo da cadeia               | Suporta 3.1? | Evidência                                                                 |
| --------------------------- | ------------ | ------------------------------------------------------------------------- |
| `@nestjs/swagger` 11.4.7    | Sim          | `new DocumentBuilder().setOpenAPIVersion('3.1.0')` emite `openapi: 3.1.0` |
| Zod 4.4.3                   | Sim          | `z.toJSONSchema()` nativo produz JSON Schema **2020-12**                  |
| `openapi-typescript` 7.13.0 | Sim          | Gera tipos a partir de 3.1                                                |

O ponto que decide: **OpenAPI 3.1 usa JSON Schema 2020-12 como dialeto**, que é
exatamente o que o Zod 4 emite. Em 3.0 seria preciso traduzir (`nullable`,
`exclusiveMinimum` booleano, remoção de `$schema`) — tradução é onde contrato e
validação divergem em silêncio.

## Decisão 1 — OpenAPI 3.1

O documento é emitido em 3.1 e versionado em `docs/api/openapi.json`.

## Decisão 2 — Documentação derivada dos schemas de validação

Em vez de adotar `nestjs-zod` (dependência a mais) ou reescrever DTOs como
classes decoradas, `packages/http-kit` expõe `ApiZodBody`, `ApiZodQuery` e
`ApiZodResponse`, que convertem o **mesmo** schema Zod que valida a entrada.

- **Alternativa preterida**: `nestjs-zod` 5.5.0 (compatível com Nest 11 + Zod 4).
  Funcionaria, mas exigiria migrar todos os DTOs para `createZodDto` e adiciona
  uma camada cujas bordas com Zod 4 teríamos que descobrir. Com
  `z.toJSONSchema()` nativo, o mesmo resultado sai de ~40 linhas próprias.
- **Consequência**: não existe "schema que valida" e "decorator que documenta" —
  há um só. Um campo novo aparece no contrato sem ninguém lembrar de atualizar.

## Decisão 3 — `openapi-typescript` + `openapi-fetch` + cliente próprio

`packages/api-client` combina três camadas:

1. **`openapi-typescript`** (dev): gera `src/schema.d.ts` do `openapi.json`.
   Só tipos, zero runtime.
2. **`openapi-fetch`** (~6 kB): rotas, parâmetros e respostas tipados.
3. **Cliente próprio** (~120 linhas): sessão, renovação com _single-flight_,
   correlação e Problem Details.

- **Alternativas preteridas**: geradores que produzem uma classe por operação
  (`hey-api`, `orval`, `openapi-generator`). Eles geram muito código para
  revisar e, principalmente, **não resolvem bem o que mais importa aqui**:
  renovação de token, correlação e erro tipado. O que é mecânico (tipos) é
  gerado; o que exige decisão (sessão, retry) é escrito e testado.

Detalhe de implementação que virou teste: a renovação usa _single-flight_. Três
401 simultâneos disparam **uma** renovação — em paralelo, rotacionariam o
refresh token três vezes, e o servidor trata reuso como vazamento (ADR-0007),
derrubando a sessão inteira do usuário.

## Decisão 4 — Deriva de contrato barrada no CI

`docs/api/openapi.json` e `packages/api-client/src/schema.d.ts` são versionados.
O CI regenera ambos e falha se houver diferença. Assim o contrato publicado
nunca fica atrás do código, e toda mudança de contrato aparece no diff do PR,
onde dá para revisar se quebra alguém.

## Riscos

- **Detecção semântica de breaking change ainda não existe.** O CI detecta
  _qualquer_ deriva, não classifica o que é incompatível. A ferramenta madura
  (`oasdiff`) é um binário Go sem pacote npm real — entra como passo de CI
  quando houver o primeiro consumidor externo. Até lá, a revisão do diff é
  humana, e a política de versionamento está em `docs/api/versioning.md`.
- `operationId` vira nome de método no SDK: renomear é breaking change.
  Estão fixados por `@ApiOperation` em cada rota.
