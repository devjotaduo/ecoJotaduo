# Estratégia de multi-tenancy

Decisão registrada no [ADR-0002](../adr/0002-multi-tenancy.md).

## Estratégia do MVP

```text
PostgreSQL compartilhado
+ tenant_id NOT NULL nas tabelas de negócio
+ TenantContext obrigatório (AsyncLocalStorage)
+ repositórios exigem TenantId tipado
+ RLS como defesa em profundidade
+ testes de isolamento por módulo
```

## Fluxo de request

```mermaid
flowchart LR
    REQUEST["Request"] --> AUTH["Autenticação"]
    AUTH --> TENANT["Resolver tenant<br/>(claim do token)"]
    TENANT --> LICENSE["Entitlement do módulo"]
    LICENSE --> POLICY["RBAC + ABAC"]
    POLICY --> USECASE["Caso de uso"]
    USECASE --> AUDIT["Auditoria"]
```

## Regras obrigatórias (checklist)

- [x] Nenhuma consulta sem contexto de tenant — repositórios recebem `TenantId` na
      assinatura; não existe sobrecarga "sem tenant".
- [x] `TenantContext` propagado por AsyncLocalStorage da borda à persistência;
      cada transação executa `set_config('app.tenant_id', …, true)` (base da RLS).
- [x] Eventos e logs carregam `correlationId`; a auditoria grava tenant, ator, canal,
      caso de uso e correlação.
- [x] Testes automatizados tentando ler/alterar dados de outro tenant (devem falhar),
      incluindo tentativa de gravar auditoria forjada.
- [x] Tabelas de plataforma explicitamente marcadas como globais; todo o resto é por
      tenant, com `tenant_id NOT NULL` e RLS.
- [ ] Cache: toda chave prefixada `t:<tenantId>:…` — **ainda não existe cache** na
      plataforma; a regra entra junto com o primeiro uso de Redis.
- [ ] Filas: payload de job transporta `tenantId` explícito e o worker restaura o
      contexto antes do handler — Fase 8.
- [ ] MCP: tools operam apenas no tenant autenticado; `tenantId` **nunca** é parâmetro
      de tool — Fase 5.

## RLS (defesa em profundidade) — implementado na Fase 2

> **Pré-requisito não óbvio**: o PostgreSQL **não aplica RLS ao dono da tabela nem a
> superusuários**. Sem um papel separado, as policies abaixo seriam decorativas.
> Ver [ADR-0007](../adr/0007-auth-and-rls-enforcement.md).

| Conexão              | Papel                       | Uso                       |
| -------------------- | --------------------------- | ------------------------- |
| `DATABASE_URL`       | `movimentar_app` (restrito) | API, MCP gateway e worker |
| `DATABASE_ADMIN_URL` | dono das tabelas            | Somente migrações e seed  |

Cada tabela com escopo de tenant recebe policy do tipo:

```sql
alter table tenancy_module_entitlements enable row level security;
create policy tenancy_module_entitlements_isolation on tenancy_module_entitlements
  using      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

O `using` filtra a leitura; o `with check` impede **gravar** linha em nome de outro
tenant. O `nullif(..., '')` é necessário porque o parâmetro pode estar vazio (fluxos
sem tenant, como o login) — nesse caso a comparação vira NULL e nada é revelado.

A aplicação define os parâmetros por transação (`set_config(..., true)`), de modo que
uma conexão devolvida ao pool nunca carrega o tenant da requisição anterior:

```ts
await withTenant(db, { tenantId, userId }, async (tx) => {
  /* consultas */
});
await withUserOnly(db, userId, async (tx) => {
  /* login, "minhas empresas" */
});
```

**Não existe leitura sem escopo.** Uma consulta fora de `withTenant`/`withUserOnly`
não devolve linha nenhuma — comportamento verificado por teste de integração.

### Tabelas de plataforma (sem escopo de tenant)

`identity_users`, `identity_service_accounts` e `identity_refresh_tokens` são globais
por natureza: o login acontece antes de qualquer tenant existir e um usuário pode ter
vínculo em várias empresas. Elas não guardam dado de negócio, e o papel da aplicação
recebe apenas `select` (mais `insert/update` nos refresh tokens).

## Evolução preparada (não implementar no MVP)

| Estratégia               | Quando                                  | O que muda                                                                |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------- |
| Schema por tenant        | Cliente grande com exigência contratual | Resolver de conexão passa a mapear tenant → schema; migrations por schema |
| Banco por tenant         | Cliente regulado / soberania de dados   | Resolver mapeia tenant → connection string dedicada                       |
| Tenant dedicado (deploy) | Requisito extremo                       | Composição atual já permite deploy isolado com um único tenant            |

A abstração de resolução de conexão em `packages/database` é o único ponto que muda;
domínio, casos de uso e adapters permanecem intactos.
