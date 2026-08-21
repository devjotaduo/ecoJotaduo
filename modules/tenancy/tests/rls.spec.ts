import { createDatabase, withTenant, withUserOnly } from '@ecojotaduo/database';
import type { DatabaseHandle } from '@ecojotaduo/database';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  prepararBancoDeTestes,
  semearTenant,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import { runMigrations } from '@ecojotaduo/database';
import { toTenantId, toUserId } from '@ecojotaduo/tenant-context';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  memberships,
  moduleEntitlements,
  organizations,
  tenants,
} from '../src/adapters/persistence/schema';

// Sem banco no CI, falha em vez de passar pulado.
exigirBancoEmCI();

/**
 * Isolamento no nível do banco, sem passar pela aplicação.
 *
 * Aqui as consultas são feitas de propósito SEM filtro de tenant no `where`:
 * o que está sendo verificado é a Row Level Security em si, ou seja, o que
 * sobra quando o código erra. Conecta com o papel restrito — a RLS não se
 * aplica ao dono das tabelas (ver docs/adr/0007-auth-and-rls-enforcement.md).
 */
describe.skipIf(!temBancoDeTeste)('RLS do módulo tenancy', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  beforeAll(async () => {
    // Serializa com as demais suítes de integração (banco compartilhado).
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });
  });

  afterAll(async () => {
    await handle.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await limparDados(dono);
    empresaA = await semearTenant(dono, {
      slug: 'empresa-a',
      nome: 'Empresa A',
      email: 'ana@empresa-a.com.br',
      modulos: ['identity'],
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      nome: 'Empresa B',
      email: 'bruno@empresa-b.com.br',
      modulos: ['tenancy'],
    });
  });

  describe('tenancy_organizations', () => {
    it('mostra apenas a organização dona do tenant da sessão', async () => {
      const vistas = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaA.tenantId) },
        (tx) => tx.select().from(organizations),
      );

      expect(vistas).toHaveLength(1);
      expect(vistas[0]?.id).toBe(empresaA.organizationId);
      expect(vistas[0]?.name).toBe('Empresa A');
    });

    it('não vaza o nome comercial da outra empresa', async () => {
      const vistasPelaB = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) => tx.select().from(organizations),
      );

      expect(vistasPelaB.map((linha) => linha.id)).not.toContain(
        empresaA.organizationId,
      );
    });

    it('no escopo de usuário, mostra só as organizações dos próprios vínculos', async () => {
      const vistas = await withUserOnly(
        handle.db,
        toUserId(empresaA.userId),
        (tx) => tx.select().from(organizations),
      );

      expect(vistas.map((linha) => linha.id)).toEqual([
        empresaA.organizationId,
      ]);
    });

    it('sem escopo nenhum, não devolve linha alguma', async () => {
      // Simula o esquecimento clássico: consulta fora de withTenant/withUserOnly.
      const vistas = await handle.db.execute(
        sql`select id from tenancy_organizations`,
      );

      expect([...vistas]).toHaveLength(0);
    });
  });

  describe('demais tabelas com escopo de tenant', () => {
    it('tenants: cada empresa enxerga apenas a si mesma', async () => {
      const vistos = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaA.tenantId) },
        (tx) => tx.select().from(tenants),
      );

      expect(vistos.map((linha) => linha.id)).toEqual([empresaA.tenantId]);
    });

    it('memberships: o vínculo da outra empresa é invisível', async () => {
      const vistos = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaA.tenantId) },
        (tx) => tx.select().from(memberships),
      );

      expect(vistos.map((linha) => linha.userId)).toEqual([empresaA.userId]);
    });

    it('module_entitlements: a contratação da outra empresa é invisível', async () => {
      const vistos = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaA.tenantId) },
        (tx) => tx.select().from(moduleEntitlements),
      );

      expect(vistos.map((linha) => linha.moduleId)).toEqual(['identity']);
      expect(vistos.map((linha) => linha.moduleId)).not.toContain('tenancy');
    });
  });
});
