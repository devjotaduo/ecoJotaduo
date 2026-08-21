import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  conexaoDoDono,
  exigirBancoEmCI,
  prepararBancoDeTestes,
  temBancoDeTeste,
} from '@ecojotaduo/test-support';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MigrationDriftError,
  assertAppRoleExists,
  runMigrations,
} from './migrator';

// Sem banco no CI, falha em vez de passar pulado.
exigirBancoEmCI();

/**
 * Testes de integração contra PostgreSQL real. Localmente, sem banco
 * configurado, a suíte é PULADA (e o relatório do Vitest mostra isso) — nunca
 * passa em silêncio.
 */
describe.skipIf(!temBancoDeTeste)('runMigrations (PostgreSQL real)', () => {
  let sql: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let diretorio: string;

  beforeAll(async () => {
    // Serializa com as demais suítes de integração (banco compartilhado).
    encerrarBanco = await prepararBancoDeTestes();
    sql = conexaoDoDono();
    diretorio = await mkdtemp(join(tmpdir(), 'ecojotaduo-migracoes-'));
    await sql`drop table if exists exemplo_migrator`;
    await sql`delete from platform_migrations where module_id = 'exemplo'`.catch(
      () => undefined,
    );
  });

  afterAll(async () => {
    await sql`drop table if exists exemplo_migrator`;
    await sql`delete from platform_migrations where module_id = 'exemplo'`;
    await sql.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  it('aplica arquivos em ordem e registra no ledger', async () => {
    await writeFile(
      join(diretorio, '0001_cria.sql'),
      'create table exemplo_migrator (id int primary key);',
    );
    await writeFile(
      join(diretorio, '0002_altera.sql'),
      'alter table exemplo_migrator add column nome text;',
    );

    const aplicadas = await runMigrations(sql, [
      { moduleId: 'exemplo', directory: diretorio },
    ]);

    expect(aplicadas.map((m) => m.id)).toEqual([
      'exemplo/0001_cria.sql',
      'exemplo/0002_altera.sql',
    ]);

    const colunas = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_name = 'exemplo_migrator' order by column_name
    `;
    expect(colunas.map((c) => c.column_name)).toEqual(['id', 'nome']);
  });

  it('é idempotente: rodar de novo não reaplica nada', async () => {
    const aplicadas = await runMigrations(sql, [
      { moduleId: 'exemplo', directory: diretorio },
    ]);
    expect(aplicadas).toEqual([]);
  });

  it('detecta migração já aplicada que foi editada (drift)', async () => {
    await writeFile(
      join(diretorio, '0001_cria.sql'),
      'create table exemplo_migrator (id int primary key); -- editado',
    );

    await expect(
      runMigrations(sql, [{ moduleId: 'exemplo', directory: diretorio }]),
    ).rejects.toThrow(MigrationDriftError);
  });

  it('confirma a existência do papel de aplicação (pré-requisito da RLS)', async () => {
    await expect(
      assertAppRoleExists(sql, 'ecojotaduo_app'),
    ).resolves.toBeUndefined();
    await expect(
      assertAppRoleExists(sql, 'papel_que_nao_existe'),
    ).rejects.toThrow(/não existe no banco/);
  });
});
