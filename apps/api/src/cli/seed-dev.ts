import { randomUUID } from 'node:crypto';

import { hashPassword } from '@ecojotaduo/auth';
import { loadEnv } from '@ecojotaduo/config';
import postgres from 'postgres';

/**
 * Cria a primeira empresa e o primeiro usuário para desenvolvimento local.
 *
 * Recusa rodar com NODE_ENV=production: a criação do tenant inicial em
 * produção é um procedimento operado, com senha vinda do gerenciador de
 * segredos (ver docs/runbooks quando a Fase 11 chegar).
 */
export async function semearDesenvolvimento(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    throw new Error('seed:dev não roda em produção.');
  }

  const url = env.DATABASE_ADMIN_URL;
  if (!url) {
    throw new Error('DATABASE_ADMIN_URL é obrigatória para semear.');
  }

  const slug = process.env.SEED_TENANT_SLUG ?? 'demo';
  const email = process.env.SEED_USER_EMAIL ?? 'admin@demo.local';
  const senha = process.env.SEED_USER_PASSWORD ?? 'senha-de-desenvolvimento';
  const PAPEL_OWNER = '00000000-0000-4000-8000-000000000001';

  const sql = postgres(url, { max: 2 });
  try {
    const [existente] = await sql<{ id: string }[]>`
      select id from tenancy_tenants where slug = ${slug}
    `;
    if (existente) {
      console.log(`Empresa "${slug}" já existe — nada a fazer.`);
      return;
    }

    const organizationId = randomUUID();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();

    await sql.begin(async (tx) => {
      await tx`insert into tenancy_organizations (id, name) values (${organizationId}, ${slug})`;
      await tx`
        insert into tenancy_tenants (id, organization_id, slug, name)
        values (${tenantId}, ${organizationId}, ${slug}, ${slug})
      `;
      await tx`
        insert into identity_users (id, email, name, password_hash)
        values (${userId}, ${email}, ${email}, ${await hashPassword(senha)})
      `;
      await tx`
        insert into tenancy_memberships (id, tenant_id, user_id)
        values (${membershipId}, ${tenantId}, ${userId})
      `;
      await tx`
        insert into tenancy_membership_roles (membership_id, role_id, tenant_id)
        values (${membershipId}, ${PAPEL_OWNER}, ${tenantId})
      `;
      // Módulos da instalação atual já contratados para a empresa demo.
      for (const moduleId of ['identity', 'tenancy']) {
        await tx`
          insert into tenancy_module_entitlements (id, tenant_id, module_id)
          values (${randomUUID()}, ${tenantId}, ${moduleId})
        `;
      }
    });

    console.log(`Empresa "${slug}" criada com o usuário ${email}.`);
    console.log(
      'Senha definida por SEED_USER_PASSWORD (padrão de desenvolvimento).',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  semearDesenvolvimento().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
