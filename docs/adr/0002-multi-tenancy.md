# ADR-0002 — Multi-tenancy com banco compartilhado e tenant_id

- **Status**: aceito
- **Data**: 2026-08-20

## Problema

A plataforma atenderá várias empresas (tenants), cada uma com um subconjunto de
módulos contratados. É preciso garantir isolamento rigoroso de dados com custo
operacional baixo no MVP, e preservar um caminho para clientes com exigências maiores
(schema dedicado ou banco dedicado).

## Alternativas consideradas

1. **Banco por tenant** — isolamento máximo, custo de operação e migração N×.
2. **Schema por tenant** — isolamento bom, mas migrations e pooling complexos desde o MVP.
3. **Banco compartilhado com `tenant_id`** — uma base, coluna `tenant_id NOT NULL` em
   toda tabela de negócio, contexto de tenant obrigatório na aplicação, RLS como
   defesa adicional.

## Decisão

Adotar a alternativa **3** no MVP, com as seguintes regras não negociáveis:

- `tenant_id NOT NULL` (+ índice composto) em toda tabela de negócio.
- `TenantContext` obrigatório, propagado por `AsyncLocalStorage` do request à
  persistência; nenhuma consulta executa sem tenant resolvido.
- Repositórios recebem `TenantId` tipado (tipo opaco) — não existe método de leitura
  ou escrita sem tenant na assinatura.
- Cache segmentado por tenant (prefixo de chave), filas e eventos transportam
  `tenantId` explícito, logs e traces incluem o tenant.
- **Row-Level Security (RLS)** habilitada nas tabelas de negócio como defesa em
  profundidade (a aplicação define `app.tenant_id` na sessão/transação).
- Testes automatizados de isolamento: todo módulo inclui testes que tentam ler/alterar
  dados de outro tenant e devem falhar.
- Ferramentas MCP operam exclusivamente no tenant autenticado; o modelo nunca escolhe
  tenant.

Estratégias futuras (schema por tenant, banco por tenant para clientes regulados)
ficam preparadas pela abstração de resolução de conexão, mas **não** serão
implementadas no MVP.

## Benefícios

- Operação e migrations únicas; onboarding de tenant instantâneo (linhas, não infra).
- Custo mínimo de infraestrutura no MVP.
- RLS cobre a classe de bug mais perigosa (query sem filtro de tenant).

## Riscos

- Vazamento por bug de aplicação — mitigado por tripla camada (repositório tipado +
  RLS + testes de isolamento).
- *Noisy neighbor* — mitigado por rate limiting por tenant e, se necessário, extração
  seletiva ou banco dedicado no futuro.

## Impacto da migração

A troca de estratégia para um tenant específico afeta apenas a camada de resolução de
conexão/contexto; domínio, casos de uso e adapters permanecem intactos.
