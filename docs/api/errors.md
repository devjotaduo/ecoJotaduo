# Erros da API

Todas as respostas de erro usam **Problem Details (RFC 9457)**, com
`Content-Type: application/problem+json`.

```jsonc
{
  "type": "https://movimentar.dev/errors/module-not-entitled",
  "title": "Módulo não contratado",
  "status": 403,
  "detail": "Módulo \"crm\" não está contratado por este tenant.",
  "instance": "/api/v1/customers",
  "correlationId": "0f3a…", // mesmo id do header e da auditoria
  "errors": ["email: e-mail inválido"], // apenas em validação (400)
}
```

## Catálogo

| `type`                | Status | Quando                                                 | Como agir                                 |
| --------------------- | ------ | ------------------------------------------------------ | ----------------------------------------- |
| `unauthorized`        | 401    | Token ausente, inválido, expirado; credenciais erradas | Autenticar de novo (ou renovar)           |
| `forbidden`           | 403    | Autenticado, sem a permissão exigida                   | Pedir o papel ao administrador da empresa |
| `module-not-entitled` | 403    | A empresa não contratou o módulo da rota               | Contratar em `POST /api/v1/modules`       |
| `tenant-inactive`     | 403    | Empresa suspensa ou arquivada                          | Falar com a administração da plataforma   |
| `invalid-request`     | 400    | Corpo/parâmetro fora do schema                         | Corrigir conforme `errors`                |
| `conflict`            | 409    | Estado já existente (ex.: módulo já ativo)             | Reler o estado atual                      |
| `http-error`          | 4xx    | Demais erros de cliente                                | Ver `detail`                              |
| `internal`            | 500    | Falha inesperada                                       | Reportar com o `correlationId`            |

## Princípios

1. **Erros de autenticação são uniformes** — a resposta nunca revela se o e-mail
   existe, se a empresa existe ou qual dos dois falhou.
2. **403 de permissão é genérico**; 403 de contratação é específico, porque é
   informação de negócio útil (e acionável) para quem já está autenticado.
3. **`detail` nunca traz stack trace, SQL ou dado de outro tenant.** O diagnóstico
   completo fica no log do servidor, correlacionado pelo `correlationId`.
4. **Validação acontece na borda**, antes do caso de uso: um 400 significa que a
   requisição nem chegou à regra de negócio.
