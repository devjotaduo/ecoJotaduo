import { randomBytes } from 'node:crypto';

import { NoopAuditLogger } from '@ecojotaduo/audit';
import {
  createDatabase,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@ecojotaduo/database';
import { SegredoAusenteError } from '@ecojotaduo/plugin-sdk';
import {
  codigoPostgres,
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  reservarBancoDeTestes,
  semearTenant,
  SQLSTATE_RLS,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import { toTenantId } from '@ecojotaduo/tenant-context';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ChangePluginStatusUseCase,
  CofreDeSegredosDoPlugin,
  ConfigurePluginUseCase,
  DrizzlePluginInstallationRepository,
  DrizzlePluginSecretRepository,
  InstallPluginUseCase,
  ListEnabledPluginsUseCase,
  ListPluginsUseCase,
  PluginCatalog,
  ResolvePluginRuntimeUseCase,
  TransicaoDePluginInvalidaError,
} from '../src/index';
import { pluginInstallations } from '../src/adapters/persistence/schema';

exigirBancoEmCI();

const PLUGIN_ID = 'plugin-de-teste';
const SEGREDO = 'valor-secreto-de-integracao';

const definicao = {
  manifest: {
    manifestVersion: '1' as const,
    id: PLUGIN_ID,
    name: 'Plugin de teste',
    version: '1.0.0',
    publisher: 'ecoJotaduo',
    type: 'first-party' as const,
    platformVersion: '^0.1.0',
    description: 'Usado apenas pelos testes de integração.',
    permissions: ['crm.customer.read'],
    capabilities: { http: true, mcp: false },
    requiredSecrets: ['signingSecret'],
    subscribesTo: [],
    publishes: [],
  },
  configSchema: z.object({ webhookUrl: z.url() }),
};

/** Comportamentos que só aparecem contra o PostgreSQL de verdade. */
describe.skipIf(!temBancoDeTeste)('Registry de plugins (integração)', () => {
  let dono: postgres.Sql;
  let liberarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  let instalacoes: DrizzlePluginInstallationRepository;
  let segredos: DrizzlePluginSecretRepository;
  let instalar: InstallPluginUseCase;
  let configurar: ConfigurePluginUseCase;
  let status: ChangePluginStatusUseCase;
  let listar: ListPluginsUseCase;
  let habilitados: ListEnabledPluginsUseCase;
  let runtime: ResolvePluginRuntimeUseCase;

  beforeAll(async () => {
    liberarBanco = await reservarBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });

    const catalogo = new PluginCatalog([definicao]);
    const cofre = new CofreDeSegredosDoPlugin(randomBytes(32));
    const audit = new NoopAuditLogger();

    instalacoes = new DrizzlePluginInstallationRepository(handle.db);
    segredos = new DrizzlePluginSecretRepository(handle.db);
    instalar = new InstallPluginUseCase(catalogo, instalacoes, audit);
    configurar = new ConfigurePluginUseCase(
      catalogo,
      instalacoes,
      segredos,
      cofre,
      audit,
    );
    status = new ChangePluginStatusUseCase(
      catalogo,
      instalacoes,
      segredos,
      audit,
    );
    runtime = new ResolvePluginRuntimeUseCase(
      catalogo,
      instalacoes,
      segredos,
      cofre,
    );
    habilitados = new ListEnabledPluginsUseCase(instalacoes);
    listar = new ListPluginsUseCase(catalogo, instalacoes, segredos, {
      verificar: () => Promise.resolve(null),
    });
  });

  afterAll(async () => {
    await handle?.close();
    await dono.end({ timeout: 5 });
    await liberarBanco?.();
  });

  beforeEach(async () => {
    await limparDados(dono);
    empresaA = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm'],
    });
  });

  async function prepararHabilitado(tenant: TenantSemeado) {
    await instalar.execute({
      tenantId: tenant.tenantId,
      pluginId: PLUGIN_ID,
      grantedPermissions: ['crm.customer.read'],
    });
    await configurar.execute({
      tenantId: tenant.tenantId,
      pluginId: PLUGIN_ID,
      config: { webhookUrl: 'https://destino.test/hook' },
      secrets: { signingSecret: SEGREDO },
    });
    return status.enable({ tenantId: tenant.tenantId, pluginId: PLUGIN_ID });
  }

  describe('ciclo completo', () => {
    it('instala, configura, habilita e entrega o runtime com o segredo aberto', async () => {
      await prepararHabilitado(empresaA);

      const resolvido = await runtime.execute({
        tenantId: empresaA.tenantId,
        pluginId: PLUGIN_ID,
        actorId: empresaA.userId,
        entitlements: ['crm'],
      });

      expect(resolvido.config).toEqual({
        webhookUrl: 'https://destino.test/hook',
      });
      expect(resolvido.segredo('signingSecret')).toBe(SEGREDO);
      expect(resolvido.grant.permissions).toEqual(['crm.customer.read']);
    });

    it('não habilita sem o segredo exigido', async () => {
      await instalar.execute({
        tenantId: empresaA.tenantId,
        pluginId: PLUGIN_ID,
        grantedPermissions: [],
      });
      await configurar.execute({
        tenantId: empresaA.tenantId,
        pluginId: PLUGIN_ID,
        config: { webhookUrl: 'https://destino.test/hook' },
      });

      await expect(
        status.enable({ tenantId: empresaA.tenantId, pluginId: PLUGIN_ID }),
      ).rejects.toThrow(TransicaoDePluginInvalidaError);
    });

    it('desabilitar tira o plugin do runtime na hora', async () => {
      await prepararHabilitado(empresaA);
      await status.disable({
        tenantId: empresaA.tenantId,
        pluginId: PLUGIN_ID,
      });

      await expect(
        runtime.execute({
          tenantId: empresaA.tenantId,
          pluginId: PLUGIN_ID,
          actorId: empresaA.userId,
          entitlements: ['crm'],
        }),
      ).rejects.toThrow(/não está habilitado/);
    });

    it('desinstalar apaga os segredos da empresa', async () => {
      await prepararHabilitado(empresaA);
      await status.uninstall({
        tenantId: empresaA.tenantId,
        pluginId: PLUGIN_ID,
      });

      expect(await segredos.listKeys(empresaA.tenantId, PLUGIN_ID)).toEqual([]);
      const linhas = await dono`select * from plugin_secrets`;
      expect(linhas).toHaveLength(0);
    });
  });

  describe('segredos', () => {
    it('o valor nunca fica em claro no banco', async () => {
      await prepararHabilitado(empresaA);

      const [linha] = await dono<{ sealed_value: string }[]>`
        select sealed_value from plugin_secrets
      `;
      expect(linha?.sealed_value).toBeDefined();
      expect(linha?.sealed_value).not.toContain(SEGREDO);
      expect(linha?.sealed_value.startsWith('v1$')).toBe(true);
    });

    it('nenhum caminho de listagem devolve o valor', async () => {
      await prepararHabilitado(empresaA);

      const catalogo = await listar.execute({ tenantId: empresaA.tenantId });
      expect(JSON.stringify(catalogo)).not.toContain(SEGREDO);
      expect(catalogo[0]?.installation?.configuredSecrets).toEqual([
        'signingSecret',
      ]);
    });

    it('segredo removido derruba a resolução em vez de assinar vazio', async () => {
      await prepararHabilitado(empresaA);
      await dono`delete from plugin_secrets`;

      await expect(
        runtime.execute({
          tenantId: empresaA.tenantId,
          pluginId: PLUGIN_ID,
          actorId: empresaA.userId,
          entitlements: ['crm'],
        }),
      ).rejects.toThrow(SegredoAusenteError);
    });
  });

  describe('isolamento entre empresas', () => {
    it('habilitar numa empresa não afeta a outra — critério de aceite da fase', async () => {
      await prepararHabilitado(empresaA);
      await instalar.execute({
        tenantId: empresaB.tenantId,
        pluginId: PLUGIN_ID,
        grantedPermissions: [],
      });

      expect(await habilitados.execute(empresaA.tenantId)).toEqual([PLUGIN_ID]);
      expect(await habilitados.execute(empresaB.tenantId)).toEqual([]);

      // E desabilitar em A também não mexe em B.
      await status.disable({
        tenantId: empresaA.tenantId,
        pluginId: PLUGIN_ID,
      });
      expect(await habilitados.execute(empresaA.tenantId)).toEqual([]);
      expect(
        (await listar.execute({ tenantId: empresaB.tenantId }))[0]?.installation
          ?.status,
      ).toBe('installed');
    });

    it('a empresa B não enxerga a configuração da empresa A', async () => {
      await prepararHabilitado(empresaA);
      expect(
        (await listar.execute({ tenantId: empresaB.tenantId }))[0]
          ?.installation,
      ).toBeNull();
    });

    it('a RLS barra a leitura mesmo em consulta sem filtro de tenant', async () => {
      // De propósito sem `where tenant_id`: é o que sobra quando o código erra.
      await prepararHabilitado(empresaA);

      const doPontoDeVistaDeB = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) => tx.select().from(pluginInstallations),
      );
      expect(doPontoDeVistaDeB).toHaveLength(0);
    });

    it('a RLS barra a ESCRITA de linha de outra empresa', async () => {
      const erro = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) =>
          tx
            .insert(pluginInstallations)
            .values({
              id: '44444444-4444-4444-8444-444444444444',
              tenantId: empresaA.tenantId,
              pluginId: PLUGIN_ID,
              version: '1.0.0',
              status: 'enabled',
              config: {},
              grantedPermissions: [],
              installedAt: new Date(),
              updatedAt: new Date(),
            })
            .then(() => null),
      ).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_RLS);
    });
  });
});
