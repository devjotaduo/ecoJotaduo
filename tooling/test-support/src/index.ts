import { randomUUID } from 'node:crypto';
import { basename, resolve } from 'node:path';

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

/**
 * Banco PRÓPRIO deste pacote, derivado do diretório em que o Vitest roda.
 *
 * Antes todas as suítes compartilhavam um banco só e um advisory lock as
 * serializava. Isso funcionou até a plataforma crescer: a espera pelo lock
 * conta dentro do `beforeAll`, então cada módulo novo empurrava a última
 * suíte para mais perto do timeout — e o CI ficou vermelho por espera, não
 * por defeito. Um banco por pacote elimina a disputa (as suítes rodam de
 * verdade em paralelo) e, de quebra, uma suíte não tem como corromper os
 * dados de outra.
 */
export function nomeDoBancoDoPacote(): string {
  const pacote = basename(process.cwd()).toLowerCase();
  return `ecojotaduo_test_${pacote.replace(/[^a-z0-9]+/g, '_')}`;
}

/** Troca o nome do banco na URL, preservando credenciais e host. */
function comBanco(url: string, banco: string): string {
  const destino = new URL(url);
  destino.pathname = `/${banco}`;
  return destino.toString();
}

export function urlDaAplicacao(): string {
  if (!APP_URL) {
    throw new Error('TEST_DATABASE_URL não definida (veja .env.test.example).');
  }
  return comBanco(APP_URL, nomeDoBancoDoPacote());
}

export function urlDoDono(): string {
  if (!ADMIN_URL) {
    throw new Error(
      'TEST_ADMIN_DATABASE_URL não definida (veja .env.test.example).',
    );
  }
  return comBanco(ADMIN_URL, nomeDoBancoDoPacote());
}

/** URL de manutenção: o banco base do `.env.test`, usado só para criar os outros. */
function urlDeManutencao(): string {
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
 * Toda suíte de banco aplica esta lista inteira, e não um subconjunto: o banco
 * do pacote nasce vazio e precisa de todas as tabelas — o `limparDados` trunca
 * todas elas. Antes, com base compartilhada, uma suíte que declarasse menos do
 * que usa passava só quando outra tivesse criado a tabela primeiro; foi assim
 * que `audit_events` derrubou o CI.
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
    {
      moduleId: 'commercial',
      directory: diretorioDeMigracoes('modules/commercial'),
    },
    {
      moduleId: 'contracts',
      directory: diretorioDeMigracoes('modules/contracts'),
    },
    { moduleId: 'assets', directory: diretorioDeMigracoes('modules/assets') },
    {
      moduleId: 'operations',
      directory: diretorioDeMigracoes('modules/operations'),
    },
  ];
}

/** Conexão como DONO das tabelas: usada para migrar e semear (ignora RLS). */
export function conexaoDoDono(): postgres.Sql {
  return postgres(urlDoDono(), { max: 4, onnotice: () => undefined });
}

/** `duplicate_database`: outro pacote criou primeiro — para nós é sucesso. */
const JA_EXISTE = '42P04';
/** `object_in_use`: dois `create database` disputando o template. Repetir. */
const TEMPLATE_OCUPADO = '55006';

/**
 * Garante que o banco DESTE pacote existe, e devolve a função de encerramento.
 *
 * Substitui o advisory lock que serializava todas as suítes: com um banco por
 * pacote não há disputa, então elas rodam em paralelo de verdade e a espera
 * some do `beforeAll`.
 *
 * Chame no `beforeAll`; a função devolvida vai no `afterAll`.
 */
export async function prepararBancoDeTestes(): Promise<() => Promise<void>> {
  const banco = nomeDoBancoDoPacote();
  const manutencao = postgres(urlDeManutencao(), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    const [existente] = await manutencao<{ um: number }[]>`
      select 1 as um from pg_database where datname = ${banco}
    `;
    if (!existente) {
      await criarBanco(manutencao, banco);
    }
  } finally {
    await manutencao.end({ timeout: 5 });
  }

  // O papel da aplicação não herda nada: precisa de permissão explícita em
  // CADA banco novo (ver docs/architecture/tenancy.md).
  const novo = postgres(urlDoDono(), { max: 1, onnotice: () => undefined });
  try {
    // Só USAGE: as tabelas são criadas pelo DONO, nas migrações. O papel da
    // aplicação nunca cria nada — é isso que faz a RLS valer para ele.
    await novo.unsafe(`grant usage on schema public to ${papelDaAplicacao()}`);
  } finally {
    await novo.end({ timeout: 5 });
  }

  return () => Promise.resolve();
}

/**
 * `create database` serializa no template: com vários pacotes subindo ao mesmo
 * tempo, um perde e recebe `object_in_use`. Repetir resolve — e se outro
 * ganhou a corrida, o banco já existe e está tudo certo.
 */
async function criarBanco(
  manutencao: postgres.Sql,
  banco: string,
): Promise<void> {
  for (let tentativa = 0; tentativa < 12; tentativa += 1) {
    try {
      await manutencao.unsafe(`create database "${banco}"`);
      return;
    } catch (erro) {
      const codigo = codigoPostgres(erro);
      if (codigo === JA_EXISTE) {
        return;
      }
      if (codigo !== TEMPLATE_OCUPADO) {
        throw erro;
      }
      await new Promise((resolver) => setTimeout(resolver, 250));
    }
  }
  throw new Error(
    `Não foi possível criar o banco de testes "${banco}": o template ficou ocupado.`,
  );
}

function papelDaAplicacao(): string {
  const url = new URL(urlDaAplicacao());
  // Só letras, dígitos e sublinhado: o nome entra num GRANT, que não aceita
  // parâmetro — validar aqui é o que impede injeção pela variável de ambiente.
  const papel = decodeURIComponent(url.username);
  if (!/^[a-z_][a-z0-9_]*$/i.test(papel)) {
    throw new Error(
      `Nome de papel inesperado em TEST_DATABASE_URL: "${papel}".`,
    );
  }
  return papel;
}

const TABELAS = [
  'audit_events',
  'operations_rentals',
  'operations_rental_numbers',
  'assets_asset_holds',
  'assets_assets',
  'contracts_contracts',
  'contracts_contract_numbers',
  'commercial_proposal_items',
  'commercial_proposals',
  'commercial_proposal_numbers',
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
