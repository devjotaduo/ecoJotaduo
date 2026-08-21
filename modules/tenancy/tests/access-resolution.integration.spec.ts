import {
  createDatabase,
  runMigrations,
  withTenant,
  DrizzleUnitOfWork,
} from '@ecojotaduo/database';
import type { Database, DatabaseHandle } from '@ecojotaduo/database';
import { NoopUnitOfWork, type UnitOfWork } from '@ecojotaduo/platform-kernel';
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
import { toTenantId } from '@ecojotaduo/tenant-context';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DrizzleEntitlementRepository,
  DrizzleMembershipRepository,
  DrizzleTenantRepository,
} from '../src/adapters/persistence/repositories';
import { ResolveAccessGrantUseCase } from '../src/application/resolve-access-grant.use-case';
import type {
  EntitlementRepository,
  MembershipRepository,
  TenantRepository,
} from '../src/ports/repositories';

exigirBancoEmCI();

/**
 * A resolução de acesso roda numa transação só (dívida aberta desde a Fase 3).
 *
 * Como se mede: `txid_current()` devolve o mesmo número para tudo o que roda
 * dentro de uma transação, e números diferentes fora dela. Os espiões abaixo
 * chamam `withTenant` com o mesmo escopo dos repositórios reais, na mesma
 * posição da cadeia — então observam a transação em que os repositórios estão
 * consultando, e não uma inventada pelo teste.
 *
 * O que se ganha é custo: quatro conexões do pool a menos por requisição
 * autenticada. Não é snapshot — o banco roda em `read committed`.
 */
describe.skipIf(!temBancoDeTeste)('resolução de acesso — uma transação', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresa: TenantSemeado;

  beforeAll(async () => {
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
    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      nome: 'Empresa A',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm', 'tenancy'],
    });
  });

  /** Id da transação corrente, visto de dentro do escopo do tenant. */
  async function transacaoCorrente(
    db: Database,
    tenantId: string,
  ): Promise<string> {
    const linhas = await withTenant(
      db,
      { tenantId: toTenantId(tenantId) },
      (tx) => tx.execute(sql`select txid_current()::text as txid`),
    );
    const [primeira] = linhas as unknown as { txid: string }[];
    return primeira?.txid ?? '';
  }

  /**
   * O caso de uso real, com os repositórios reais, cada um precedido de uma
   * leitura que anota em qual transação ele vai rodar.
   */
  function montar(uow: UnitOfWork) {
    const vistas: string[] = [];
    const db = handle.db;
    const anotar = async () => {
      vistas.push(await transacaoCorrente(db, empresa.tenantId));
    };

    const tenants = new DrizzleTenantRepository(db);
    const vinculos = new DrizzleMembershipRepository(db);
    const contratacoes = new DrizzleEntitlementRepository(db);

    const tenantsEspiao: TenantRepository = {
      findById: async (id) => {
        await anotar();
        return tenants.findById(id);
      },
      findBySlugForUser: (slug, userId) =>
        tenants.findBySlugForUser(slug, userId),
      listForUser: (userId) => tenants.listForUser(userId),
    };

    const vinculosEspiao: MembershipRepository = {
      findActive: async (tenantId, userId) => {
        await anotar();
        return vinculos.findActive(tenantId, userId);
      },
      listPermissions: async (tenantId, membershipId) => {
        await anotar();
        return vinculos.listPermissions(tenantId, membershipId);
      },
    };

    const contratacoesEspiao: EntitlementRepository = {
      list: async (tenantId) => {
        await anotar();
        return contratacoes.list(tenantId);
      },
      find: (tenantId, moduleId) => contratacoes.find(tenantId, moduleId),
      grant: (entrada) => contratacoes.grant(entrada),
      revoke: (tenantId, moduleId) => contratacoes.revoke(tenantId, moduleId),
    };

    const caso = new ResolveAccessGrantUseCase(
      tenantsEspiao,
      vinculosEspiao,
      contratacoesEspiao,
      uow,
      [
        {
          // Plugins habilitados: a quinta leitura da cadeia.
          listEntitlements: async () => {
            await anotar();
            return [];
          },
        },
      ],
    );
    return { caso, vistas };
  }

  it('as cinco leituras compartilham a mesma transação', async () => {
    const { caso, vistas } = montar(new DrizzleUnitOfWork(handle.db));

    const { grant } = await caso.execute({
      tenantId: empresa.tenantId,
      userId: empresa.userId,
      scopes: ['*'],
    });

    expect(grant.entitlements).toContain('crm');
    expect(vistas).toHaveLength(5);
    expect(new Set(vistas).size).toBe(1);
  });

  it('sem a unidade são cinco transações — a medida distingue', async () => {
    // Prova que o teste acima consegue falhar: é o comportamento anterior à
    // Fase 10, medido pelo mesmo instrumento.
    const { caso, vistas } = montar(new NoopUnitOfWork());

    await caso.execute({
      tenantId: empresa.tenantId,
      userId: empresa.userId,
      scopes: ['*'],
    });

    expect(new Set(vistas).size).toBe(5);
  });

  it('a conta de serviço também resolve numa transação', async () => {
    const { caso, vistas } = montar(new DrizzleUnitOfWork(handle.db));

    const grant = await caso.executeForServiceAccount({
      tenantId: empresa.tenantId,
      scopes: ['crm.customer.read'],
    });

    expect(grant.entitlements).toContain('crm');
    // Conta de serviço não tem vínculo nem papéis: são três leituras.
    expect(vistas).toHaveLength(3);
    expect(new Set(vistas).size).toBe(1);
  });

  it('dentro da unidade, o escopo de usuário vale como valeria fora', async () => {
    const uow = new DrizzleUnitOfWork(handle.db);
    const vinculos = new DrizzleMembershipRepository(handle.db);

    // A unidade é aberta sem usuário; a consulta pede o escopo dele. O
    // `app.user_id` é refixado na transação, de modo que estar ou não numa
    // unidade não muda o resultado — antes disso, a policy que lê
    // `app.user_id` devolveria zero linhas aqui e a linha certa lá fora.
    const dentro = await uow.executar(empresa.tenantId, () =>
      vinculos.findActive(empresa.tenantId, empresa.userId),
    );
    const fora = await vinculos.findActive(empresa.tenantId, empresa.userId);

    expect(dentro).not.toBeNull();
    expect(dentro?.id).toBe(fora?.id);
  });

  it('o usuário refixado vale para as consultas seguintes da unidade', async () => {
    const uow = new DrizzleUnitOfWork(handle.db);
    const vinculos = new DrizzleMembershipRepository(handle.db);

    const lido = await uow.executar(empresa.tenantId, async () => {
      await vinculos.findActive(empresa.tenantId, empresa.userId);
      const linhas = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresa.tenantId) },
        (tx) =>
          tx.execute(sql`select current_setting('app.user_id', true) as uid`),
      );
      const [primeira] = linhas as unknown as { uid: string }[];
      return primeira?.uid ?? '';
    });

    expect(lido).toBe(empresa.userId);
  });

  it('a unidade continua recusando operação de outra empresa', async () => {
    const outra = await semearTenant(dono, {
      slug: 'empresa-b',
      nome: 'Empresa B',
      email: 'bruno@empresa-b.com.br',
      modulos: [],
    });
    const uow = new DrizzleUnitOfWork(handle.db);

    await expect(
      uow.executar(empresa.tenantId, () =>
        transacaoCorrente(handle.db, outra.tenantId),
      ),
    ).rejects.toThrow(/pertence a uma empresa só/);
  });
});
