-- Fecha a lacuna de RLS em tenancy_organizations.
--
-- A migração 0001 concedeu `select` da tabela ao papel da aplicação sem ligar
-- Row Level Security. Nenhum código lê essa tabela hoje, então não houve
-- vazamento — mas a defesa em profundidade estava ausente justamente onde
-- ficam os nomes comerciais das empresas clientes.
--
-- A policy não repete as condições de `tenancy_tenants`: ela pergunta quais
-- tenants estão visíveis. Como a subconsulta roda com o papel da aplicação
-- (sem BYPASSRLS), a RLS de `tenancy_tenants` também se aplica ali dentro —
-- logo, uma organização é visível exatamente quando possui um tenant visível.
-- Isso mantém as duas regras alinhadas por construção, sem duplicação.

alter table tenancy_organizations enable row level security;

drop policy if exists tenancy_organizations_visibility on tenancy_organizations;
create policy tenancy_organizations_visibility on tenancy_organizations
  using (id in (select t.organization_id from tenancy_tenants t));
