import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { hashPassword } from '@ecojotaduo/auth';
import postgres from 'postgres';

/**
 * Apoio aos testes de integração.
 *
 * Não depende de nenhum módulo de domínio (só de `postgres` e do pacote de
 * criptografia) para não criar ciclo entre pacotes do workspace: quem é
 * testado importa daqui, nunca o contrário.
 */

export const APP_URL = process.env.TEST_DATABASE_URL;
export const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;

/** Quando falso, as suítes de integração se declaram puladas (nunca "verdes"). */
export const temBancoDeTeste = Boolean(APP_URL && ADMIN_URL);

/**
 * No CI, banco ausente é ERRO — não motivo para pular.
 *
 * Localmente, pular é conveniente (nem todo mundo sobe o Docker para mexer em
 * documentação). Num pipeline, porém, uma suíte pulada sai verde e daria a
 * impressão de que o isolamento entre tenants foi verificado quando não foi.
 * Chame no topo de cada suíte de integração.
 */
export function exigirBancoEmCI(): void {
  if (!temBancoDeTeste && process.env.CI) {
    throw new Error(
      'CI sem banco de testes: TEST_DATABASE_URL/TEST_ADMIN_DATABASE_URL ausentes. ' +
        'As suítes de integração seriam puladas silenciosamente.',
    );
  }
}

export function urlDaAplicacao(): string {
  if (!APP_URL) {
    throw new Error('TEST_DATABASE_URL não definida (veja .env.test.example).');
  }
  return APP_URL;
}

export function urlDoDono(): string {
  if (!ADMIN_URL) {
    throw new Error(
      'TEST_ADMIN_DATABASE_URL não definida (veja .env.test.example).',
    );
  }
  return ADMIN_URL;
}

export function raizDoRepositorio(): string {
  // Todo pacote do workspace fica dois níveis abaixo da raiz.
  return resolve(process.cwd(), '..', '..');
}

/** Diretório de migrações de um pacote, a partir do caminho no monorepo. */
export function diretorioDeMigracoes(caminhoRelativo: string): string {
  return resolve(raizDoRepositorio(), caminhoRelativo, 'migrations');
}

/**
 * Migrações da plataforma, na ordem em que os manifestos as encadeiam.
 *
 * Toda suíte de banco aplica esta lista inteira, e não um subconjunto: as
 * suítes compartilham a base e rodam em ordem arbitrária (o advisory lock
 * serializa, não ordena). Uma suíte que declarasse menos do que usa passaria
 * só quando outra tivesse criado a tabela antes — foi o que aconteceu com
 * `audit_events`, que o `limparDados` trunca em TODAS elas.
 *
 * A lista é literal de propósito: `tooling/test-support` não pode importar
 * `@ecojotaduo/database` nem os módulos, senão o grafo do turbo cicla.
 */
export function migracoesDaPlataforma(): {
  moduleId: string;
  directory: string;
}[] {
  return [
    { moduleId: 'audit', directory: diretorioDeMigracoes('packages/audit') },
    {
      moduleId: 'identity',
      directory: diretorioDeMigracoes('modules/identity'),
    },
    { moduleId: 'tenancy', directory: diretorioDeMigracoes('modules/tenancy') },
    { moduleId: 'plugins', directory: diretorioDeMigracoes('modules/plugins') },
    { moduleId: 'crm', directory: diretorioDeMigracoes('modules/crm') },
  ];
}

/** Conexão como DONO das tabelas: usada para migrar e semear (ignora RLS). */
export function conexaoDoDono(): postgres.Sql {
  return postgres(urlDoDono(), { max: 4, onnotice: () => undefined });
}

// Identificador fixo e arbitrário do advisory lock que serializa as suítes.
const LOCK_SUITES = 4_071_984;

/**
 * Garante que apenas uma suíte de integração use o banco por vez.
 *
 * Os pacotes rodam em paralelo (turbo), mas compartilham o mesmo banco de
 * testes: sem isto, o `truncate` de uma suíte apaga os dados que outra acabou
 * de semear. O lock é de SESSÃO, em uma conexão dedicada — encerrar a conexão
 * libera o lock, então não há risco de travar o banco se um teste quebrar.
 *
 * Devolve a função de liberação, para chamar no `afterAll`.
 */
export async function reservarBancoDeTestes(): Promise<() => Promise<void>> {
  const cliente = postgres(urlDoDono(), { max: 1, onnotice: () => undefined });
  await cliente`select pg_advisory_lock(${LOCK_SUITES})`;
  return () => cliente.end({ timeout: 5 });
}

const TABELAS = [
  'audit_events',
  'plugin_secrets',
  'plugin_installations',
  'tenancy_module_entitlements',
  'tenancy_membership_roles',
  'tenancy_memberships',
  'tenancy_tenants',
  'tenancy_organizations',
  'identity_refresh_tokens',
  'identity_service_accounts',
  'identity_users',
];

/** Zera os dados entre testes, preservando o schema e os papéis de sistema. */
export async function limparDados(sql: postgres.Sql): Promise<void> {
  for (const tabela of TABELAS) {
    await sql`truncate table ${sql(tabela)} cascade`;
  }
  // Papéis de sistema vêm da migração e são recriados aqui após o truncate.
  await sql`
    insert into tenancy_roles (id, tenant_id, key, name) values
      ('00000000-0000-4000-8000-000000000001', null, 'owner',  'Proprietário'),
      ('00000000-0000-4000-8000-000000000002', null, 'admin',  'Administrador'),
      ('00000000-0000-4000-8000-000000000003', null, 'member', 'Membro')
    on conflict (id) do nothing
  `;
  await sql`
    insert into tenancy_role_permissions (role_id, tenant_id, permission) values
      ('00000000-0000-4000-8000-000000000001', null, '*'),
      ('00000000-0000-4000-8000-000000000002', null, 'platform.*')
    on conflict do nothing
  `;
}

/** SQLSTATE devolvido pelo PostgreSQL quando uma policy de RLS barra a linha. */
export const SQLSTATE_RLS = '42501';

/**
 * Extrai o código SQLSTATE de um erro. O Drizzle embrulha o erro do driver,
 * então é preciso percorrer a cadeia de `cause` — asserção por mensagem de
 * texto seria frágil.
 */
export function codigoPostgres(erro: unknown): string | undefined {
  let atual: unknown = erro;
  for (let nivel = 0; nivel < 5 && atual instanceof Error; nivel += 1) {
    const codigo = (atual as { code?: unknown }).code;
    if (typeof codigo === 'string') {
      return codigo;
    }
    atual = atual.cause;
  }
  return undefined;
}

export const PAPEL_OWNER = '00000000-0000-4000-8000-000000000001';
export const PAPEL_ADMIN = '00000000-0000-4000-8000-000000000002';
export const PAPEL_MEMBER = '00000000-0000-4000-8000-000000000003';

export interface TenantSemeado {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly slug: string;
  readonly userId: string;
  readonly email: string;
  readonly senha: string;
  readonly membershipId: string;
}

export interface OpcoesDeSeed {
  readonly slug: string;
  readonly nome?: string;
  readonly email: string;
  readonly senha?: string;
  readonly papelId?: string;
  readonly modulos?: readonly string[];
  readonly statusTenant?: 'active' | 'suspended';
}

/** Cria organização, tenant, usuário, vínculo, papel e módulos contratados. */
export async function semearTenant(
  sql: postgres.Sql,
  opcoes: OpcoesDeSeed,
): Promise<TenantSemeado> {
  const organizationId = randomUUID();
  const tenantId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const senha = opcoes.senha ?? 'senha-de-teste-123';
  const papelId = opcoes.papelId ?? PAPEL_OWNER;

  await sql`
    insert into tenancy_organizations (id, name)
    values (${organizationId}, ${opcoes.nome ?? opcoes.slug})
  `;
  await sql`
    insert into tenancy_tenants (id, organization_id, slug, name, status)
    values (${tenantId}, ${organizationId}, ${opcoes.slug}, ${opcoes.nome ?? opcoes.slug},
            ${opcoes.statusTenant ?? 'active'})
  `;
  await sql`
    insert into identity_users (id, email, name, password_hash)
    values (${userId}, ${opcoes.email}, ${opcoes.email}, ${await hashPassword(senha)})
  `;
  await sql`
    insert into tenancy_memberships (id, tenant_id, user_id)
    values (${membershipId}, ${tenantId}, ${userId})
  `;
  await sql`
    insert into tenancy_membership_roles (membership_id, role_id, tenant_id)
    values (${membershipId}, ${papelId}, ${tenantId})
  `;

  for (const moduleId of opcoes.modulos ?? []) {
    await sql`
      insert into tenancy_module_entitlements (id, tenant_id, module_id)
      values (${randomUUID()}, ${tenantId}, ${moduleId})
    `;
  }

  return {
    tenantId,
    organizationId,
    slug: opcoes.slug,
    userId,
    email: opcoes.email,
    senha,
    membershipId,
  };
}

/** Cria uma service account (o segredo é devolvido em claro só no teste). */
export async function semearServiceAccount(
  sql: postgres.Sql,
  entrada: {
    tenantId: string;
    clientId: string;
    secretHash: string;
    scopes: readonly string[];
  },
): Promise<{ serviceAccountId: string }> {
  const serviceAccountId = randomUUID();
  await sql`
    insert into identity_service_accounts (id, tenant_id, name, client_id, secret_hash, scopes)
    values (${serviceAccountId}, ${entrada.tenantId}, ${entrada.clientId},
            ${entrada.clientId}, ${entrada.secretHash}, ${entrada.scopes as string[]})
  `;
  return { serviceAccountId };
}
