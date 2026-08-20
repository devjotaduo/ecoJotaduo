import { loadEnv } from '@ecojotaduo/config';
import {
  assertAppRoleExists,
  resolveMigrationsDirectory,
  runMigrations,
  type MigrationSource,
} from '@ecojotaduo/database';
import postgres from 'postgres';

import { catalogoDeModulos } from '../bootstrap/modules';

/**
 * Aplica as migrações pendentes.
 *
 * Conecta como DONO das tabelas (DATABASE_ADMIN_URL) — a aplicação em si roda
 * com um papel restrito, sem DDL. A ordem vem do grafo de dependências entre
 * módulos, resolvido pelo kernel; migrações da plataforma (auditoria) vêm
 * antes das dos módulos.
 */
export async function migrar(): Promise<void> {
  const env = loadEnv();
  const url = env.DATABASE_ADMIN_URL;
  if (!url) {
    throw new Error(
      'DATABASE_ADMIN_URL é obrigatória para migrar (conexão do dono das tabelas).',
    );
  }

  const catalogo = catalogoDeModulos();
  const fontes: MigrationSource[] = [
    {
      moduleId: 'audit',
      directory: resolveMigrationsDirectory(require, '@ecojotaduo/audit'),
    },
    ...catalogo.migrationSources.map((fonte) => ({
      moduleId: fonte.moduleId,
      directory: resolveMigrationsDirectory(require, fonte.packageName),
    })),
  ];

  // Silencia os NOTICE do PostgreSQL: DDL idempotente ("... does not exist,
  // skipping") gera ruído esperado que esconderia a saída útil.
  const sql = postgres(url, { max: 2, onnotice: () => undefined });
  try {
    await assertAppRoleExists(sql, env.DATABASE_APP_ROLE);
    const aplicadas = await runMigrations(sql, fontes);

    if (aplicadas.length === 0) {
      console.log('Nenhuma migração pendente.');
      return;
    }
    for (const migracao of aplicadas) {
      console.log(`aplicada: ${migracao.id}`);
    }
    console.log(`${aplicadas.length} migração(ões) aplicada(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  migrar().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
