import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type postgres from 'postgres';

/** Cada módulo é dono das suas migrações; a ordem da lista resolve dependências. */
export interface MigrationSource {
  readonly moduleId: string;
  readonly directory: string;
}

/**
 * Descobre o diretório `migrations/` de um pacote a partir do seu nome.
 *
 * Recebe o `require` de quem chama (CommonJS) ou um `createRequire(...)`
 * (ESM/testes), em vez de depender de `__dirname` — que não existe nos dois
 * mundos. O pacote precisa expor `./package.json` no campo `exports`.
 */
export function resolveMigrationsDirectory(
  requireFn: { resolve(id: string): string },
  packageName: string,
): string {
  return join(
    dirname(requireFn.resolve(`${packageName}/package.json`)),
    'migrations',
  );
}

export interface AppliedMigration {
  readonly id: string;
  readonly moduleId: string;
}

export class MigrationDriftError extends Error {
  constructor(id: string) {
    super(
      `A migração "${id}" já aplicada foi alterada no repositório. ` +
        'Migrações são imutáveis: crie um novo arquivo em vez de editar o antigo.',
    );
    this.name = 'MigrationDriftError';
  }
}

export class MissingAppRoleError extends Error {
  constructor(role: string) {
    super(
      `O papel de aplicação "${role}" não existe no banco. Ele é obrigatório: ` +
        'a RLS não se aplica ao dono das tabelas nem a superusuários. ' +
        'Em desenvolvimento, recrie o container (docker/init cria o papel).',
    );
    this.name = 'MissingAppRoleError';
  }
}

const LEDGER = 'platform_migrations';
// Identificador arbitrário e fixo para o advisory lock: impede que duas
// réplicas apliquem migrações ao mesmo tempo durante um deploy.
const LOCK_ID = 4_071_983;

async function garantirLedger(sql: postgres.Sql): Promise<void> {
  await sql`
    create table if not exists ${sql(LEDGER)} (
      id          text primary key,
      module_id   text        not null,
      checksum    text        not null,
      applied_at  timestamptz not null default now()
    )
  `;
}

async function arquivosDe(directory: string): Promise<string[]> {
  const entradas = await readdir(directory);
  return entradas.filter((nome) => nome.endsWith('.sql')).sort();
}

/**
 * Aplica as migrações pendentes, em ordem, cada uma em sua transação.
 * Conecta como DONO das tabelas (não como o papel da aplicação).
 */
export async function runMigrations(
  sql: postgres.Sql,
  fontes: readonly MigrationSource[],
): Promise<AppliedMigration[]> {
  await garantirLedger(sql);

  const aplicadas: AppliedMigration[] = [];

  for (const fonte of fontes) {
    for (const arquivo of await arquivosDe(fonte.directory)) {
      const id = `${fonte.moduleId}/${arquivo}`;
      // Conteúdo versionado no próprio repositório — não é entrada externa.
      const conteudo = await readFile(join(fonte.directory, arquivo), 'utf8');
      const checksum = createHash('sha256').update(conteudo).digest('hex');

      const [registro] = await sql<{ checksum: string }[]>`
        select checksum from ${sql(LEDGER)} where id = ${id}
      `;

      if (registro) {
        if (registro.checksum !== checksum) {
          throw new MigrationDriftError(id);
        }
        continue;
      }

      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(${LOCK_ID})`;
        await tx.unsafe(conteudo);
        await tx`
          insert into ${tx(LEDGER)} (id, module_id, checksum)
          values (${id}, ${fonte.moduleId}, ${checksum})
          on conflict (id) do nothing
        `;
      });

      aplicadas.push({ id, moduleId: fonte.moduleId });
    }
  }

  return aplicadas;
}

/** A RLS só é efetiva se a aplicação conectar com um papel sem privilégio de dono. */
export async function assertAppRoleExists(
  sql: postgres.Sql,
  role: string,
): Promise<void> {
  const [encontrado] = await sql<{ existe: boolean }[]>`
    select true as existe from pg_roles where rolname = ${role}
  `;
  if (!encontrado) {
    throw new MissingAppRoleError(role);
  }
}
