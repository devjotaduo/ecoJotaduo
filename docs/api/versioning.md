# Versionamento da API

## Duas versões, papéis diferentes

| O quê                                    | Onde aparece            | Muda quando                                      |
| ---------------------------------------- | ----------------------- | ------------------------------------------------ |
| **Versão do caminho** (`/api/v1`)        | URL de toda rota        | Só em quebra incompatível que não dá para evitar |
| **Versão do documento** (`info.version`) | `docs/api/openapi.json` | A cada release, seguindo SemVer                  |

O prefixo `/api/v1` é o contrato com quem já integrou. `v2` só nasce quando uma
mudança incompatível for inevitável — e as duas convivem durante a depreciação
(ver [deprecation.md](deprecation.md)).

## O que é mudança compatível

Pode entrar em `v1` sem aviso:

- rota nova, campo **opcional** novo no corpo de entrada;
- campo novo na resposta (o cliente ignora o que não conhece);
- valor novo em enum de **entrada**;
- afrouxar validação (aceitar o que antes era recusado).

## O que é quebra

Exige `v2` ou ciclo de depreciação:

- remover ou renomear rota, campo de resposta ou `operationId`;
- tornar obrigatório um campo de entrada que era opcional;
- apertar validação (tamanho, formato, faixa);
- valor novo em enum de **resposta** — o cliente pode ter `switch` exaustivo;
- mudar status HTTP ou o `type` de um Problem Details;
- mudar o significado de um campo mantendo o nome. **A pior de todas**: não
  quebra compilação em lugar nenhum e só aparece como dado errado em produção.

### `operationId` é contrato

Cada `operationId` vira nome de método no SDK gerado. Renomear compila do lado
do servidor e quebra todo consumidor. Estão fixados explicitamente em
`@ApiOperation({ operationId: '...' })` — nunca inferidos do nome do método.

## Como o contrato é mantido honesto

`docs/api/openapi.json` e `packages/api-client/src/schema.d.ts` são versionados
no repositório. O CI regenera os dois e **falha se houver qualquer diferença**.

Consequências práticas:

1. o contrato publicado nunca fica atrás do código;
2. toda mudança de contrato aparece no diff do PR, onde se avalia se é quebra;
3. quem muda a API é obrigado a rodar `pnpm --filter @ecojotaduo/api openapi` e
   `pnpm --filter @ecojotaduo/api-client generate`, e a olhar o resultado.

A classificação **semântica** (isto é quebra?) ainda é revisão humana — a
automação detecta deriva, não incompatibilidade. Quando houver o primeiro
consumidor externo, entra `oasdiff` no CI (ver riscos do ADR-0008).

## Versão do documento (SemVer)

```
MAJOR — quebra publicada (acompanha um /api/vN novo)
MINOR — capacidade nova compatível
PATCH — correção de documentação ou comportamento sem mudança de contrato
```

O valor vive em `apps/api/src/bootstrap/openapi.ts` (`VERSAO_DA_API`), num só
lugar, e é o que o SDK e o `openapi.json` carregam.
