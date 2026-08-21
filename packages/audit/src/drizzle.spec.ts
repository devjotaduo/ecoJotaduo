import {
  createDatabase,
  runMigrations,
  type DatabaseHandle,
} from '@ecojotaduo/database';
import {
  codigoPostgres,
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  prepararBancoDeTestes,
  semearTenant,
  SQLSTATE_RLS,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import {
  authenticateContext,
  createContext,
  runWithContext,
  toTenantId,
  toUserId,
} from '@ecojotaduo/tenant-context';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DrizzleAuditLogger, auditEvents } from './drizzle';

// Sem banco no CI, falha em vez de passar pulado.
exigirBancoEmCI();

/**
 * Isolamento da trilha de auditoria entre empresas, contra PostgreSQL real e
 * conectando com o papel restrito (é sobre ele que a RLS atua).
 */
describe.skipIf(!temBancoDeTeste)(
  'DrizzleAuditLogger (isolamento por tenant)',
  () => {
    let dono: postgres.Sql;
    let encerrarBanco: (() => Promise<void>) | undefined;
    let handle: DatabaseHandle;
    let logger: DrizzleAuditLogger;
    let empresaA: TenantSemeado;
    let empresaB: TenantSemeado;

    beforeAll(async () => {
      // Serializa com as demais suítes de integração (banco compartilhado).
      encerrarBanco = await prepararBancoDeTestes();
      dono = conexaoDoDono();
      await runMigrations(dono, migracoesDaPlataforma());
      handle = createDatabase({ url: urlDaAplicacao(), quiet: true });
      logger = new DrizzleAuditLogger(handle.db);
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
        email: 'a@a.com.br',
      });
      empresaB = await semearTenant(dono, {
        slug: 'empresa-b',
        email: 'b@b.com.br',
      });
    });

    function comoUsuario<T>(
      tenant: TenantSemeado,
      fn: () => Promise<T>,
    ): Promise<T> {
      const contexto = createContext('rest');
      return runWithContext(contexto, () => {
        authenticateContext(contexto, {
          tenantId: toTenantId(tenant.tenantId),
          userId: toUserId(tenant.userId),
          actor: { kind: 'user', id: tenant.userId },
          permissions: ['*'],
          scopes: ['*'],
          entitlements: [],
        });
        return fn();
      });
    }

    it('grava o evento com tenant, ator, canal e correlação do contexto', async () => {
      await comoUsuario(empresaA, () =>
        logger.record({
          action: 'tenancy.module.granted',
          result: 'success',
          resourceType: 'module',
          resourceId: 'crm',
        }),
      );

      const { items, total } = await comoUsuario(empresaA, () =>
        logger.list({ limit: 10, offset: 0 }),
      );

      expect(total).toBe(1);
      expect(items[0]).toMatchObject({
        tenantId: empresaA.tenantId,
        action: 'tenancy.module.granted',
        actorId: empresaA.userId,
        channel: 'rest',
        result: 'success',
      });
    });

    it('empresa B não enxerga a auditoria da empresa A', async () => {
      await comoUsuario(empresaA, () =>
        logger.record({ action: 'segredo.da.empresa.a', result: 'success' }),
      );

      const resultado = await comoUsuario(empresaB, () =>
        logger.list({ limit: 50, offset: 0 }),
      );

      expect(resultado.items).toEqual([]);
      expect(resultado.total).toBe(0);
    });

    it('RLS bloqueia leitura mesmo em consulta SEM filtro de tenant', async () => {
      await comoUsuario(empresaA, () =>
        logger.record({ action: 'evento.da.a', result: 'success' }),
      );
      await comoUsuario(empresaB, () =>
        logger.record({ action: 'evento.da.b', result: 'success' }),
      );

      // Simula um bug: SELECT direto na tabela, sem where de tenant.
      const vistosPelaB = await comoUsuario(empresaB, async () => {
        const { withTenant } = await import('@ecojotaduo/database');
        return withTenant(
          handle.db,
          { tenantId: toTenantId(empresaB.tenantId) },
          (tx) => tx.select().from(auditEvents),
        );
      });

      expect(vistosPelaB).toHaveLength(1);
      expect(vistosPelaB[0]?.action).toBe('evento.da.b');
    });

    it('não permite gravar auditoria em nome de outro tenant (with check)', async () => {
      const { withTenant } = await import('@ecojotaduo/database');
      const { randomUUID } = await import('node:crypto');

      // Tentativa explícita de forjar: contexto da B, tenant_id da A na linha.
      const erro = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) =>
          tx.insert(auditEvents).values({
            id: randomUUID(),
            tenantId: empresaA.tenantId,
            actorKind: 'user',
            actorId: empresaB.userId,
            channel: 'rest',
            action: 'ataque.forjar.auditoria',
            result: 'success',
            correlationId: randomUUID(),
            occurredAt: new Date(),
          }),
      ).catch((causa: unknown) => causa);

      // 42501: a policy `with check` barrou a linha dentro do próprio banco.
      expect(codigoPostgres(erro)).toBe(SQLSTATE_RLS);

      const naEmpresaA = await comoUsuario(empresaA, () =>
        logger.list({ limit: 10, offset: 0 }),
      );
      expect(naEmpresaA.total).toBe(0);
    });

    it('limita a paginação a um teto seguro', async () => {
      await comoUsuario(empresaA, async () => {
        for (let i = 0; i < 3; i += 1) {
          await logger.record({ action: `evento.${i}`, result: 'success' });
        }
      });

      const resultado = await comoUsuario(empresaA, () =>
        logger.list({ limit: 9999, offset: 0 }),
      );

      expect(resultado.items).toHaveLength(3);
      expect(resultado.total).toBe(3);
    });

    it('filtra por ação dentro do tenant', async () => {
      await comoUsuario(empresaA, async () => {
        await logger.record({
          action: 'tenancy.module.granted',
          result: 'success',
        });
        await logger.record({
          action: 'tenancy.module.revoked',
          result: 'success',
        });
      });

      const resultado = await comoUsuario(empresaA, () =>
        logger.list({ action: 'tenancy.module.revoked', limit: 10, offset: 0 }),
      );

      expect(resultado.total).toBe(1);
      expect(resultado.items[0]?.action).toBe('tenancy.module.revoked');
    });
  },
);
