# Política de depreciação

## Princípio

Nada some sem aviso. Um consumidor que integrou hoje precisa continuar
funcionando enquanto tiver tempo hábil de migrar — e precisa **descobrir** que
algo vai sair sem ler release notes.

## Ciclo

```
anunciada  →  em depreciação (mínimo 90 dias)  →  removida
```

| Fase               | O que acontece                                                      | O que o cliente vê                               |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------ |
| **Anunciada**      | Rota marcada `deprecated: true` no OpenAPI, com substituta indicada | Aviso no SDK e na documentação                   |
| **Em depreciação** | Continua funcionando por completo                                   | Header `Deprecation` e `Sunset` em toda resposta |
| **Removida**       | Rota responde 410 Gone por mais 90 dias, depois 404                 | Erro claro apontando a substituta                |

O prazo mínimo é de **90 dias** para consumidores internos e **180 dias** quando
houver integração de terceiros contratada.

## Como marcar

```ts
@ApiOperation({
  operationId: 'crmSearchCustomers',
  summary: 'Pesquisa clientes',
  deprecated: true,
  description: 'Use `crmSearchCustomersV2`. Remoção prevista para 2027-02-01.',
})
```

O `deprecated: true` entra no `openapi.json`, e daí no SDK gerado: o editor
risca a chamada no autocompletar. É o aviso que chega sem ninguém ler changelog.

## Headers (a partir da Fase 10)

```http
Deprecation: Sat, 01 Nov 2026 00:00:00 GMT
Sunset: Mon, 01 Feb 2027 00:00:00 GMT
Link: <https://jotaduo.com/ecojotaduo/docs/crm>; rel="successor-version"
```

## O que nunca é depreciado silenciosamente

- `operationId` — renomear quebra o SDK de todo mundo;
- `type` de Problem Details — clientes tratam erro por ele;
- semântica de um campo. Mudou o significado? Campo novo, nome novo, e o antigo
  entra em depreciação. Reaproveitar o nome é a quebra que ninguém detecta.
