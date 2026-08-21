import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { loadEnv } from '@ecojotaduo/config';
import { runMigrations } from '@ecojotaduo/database';
import {
  criarNucleo,
  type NucleoDaPlataforma,
} from '@ecojotaduo/platform-core';
import {
  CABECALHO_ASSINATURA,
  CABECALHO_TIMESTAMP,
} from '@ecojotaduo/plugin-notifications-example';
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
import {
  authenticateContext,
  createContext,
  runWithContext,
  toTenantId,
  toUserId,
} from '@ecojotaduo/tenant-context';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { PLATFORM_CORE } from '../src/bootstrap/tokens';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';
import { registrarContextoDeRequisicao } from '../src/http/request-context';

exigirBancoEmCI();

const PLUGIN = 'notifications-example';
const SEGREDO = 'segredo-de-assinatura-do-teste-e2e';

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

interface EntregaRecebida {
  readonly corpo: string;
  readonly assinatura: string | undefined;
  readonly timestamp: string | undefined;
}

/**
 * Fase 6 ponta a ponta.
 *
 * O critério de aceite da fase é o bloco "isolamento": habilitar ou
 * desabilitar um plugin numa empresa não muda nada na outra — nem a rota, nem
 * a tool MCP, nem o catálogo.
 */
describe.skipIf(!temBancoDeTeste)('Plugins (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let nucleo: NucleoDaPlataforma;
  let destino: Server;
  let urlDoDestino: string;
  let recebidas: EntregaRecebida[] = [];

  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  async function requisicao(opcoes: {
    method: 'GET' | 'POST' | 'DELETE';
    url: string;
    token?: string;
    payload?: unknown;
  }): Promise<RespostaHttp> {
    return app.inject({
      method: opcoes.method,
      url: opcoes.url,
      payload: opcoes.payload as never,
      headers: opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {},
    });
  }

  async function entrar(tenant: TenantSemeado): Promise<string> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: tenant.email,
        password: tenant.senha,
        tenantSlug: tenant.slug,
      },
    });
    expect(resposta.statusCode).toBe(200);
    return (resposta.json() as { accessToken: string }).accessToken;
  }

  /** Instala, configura e habilita o plugin na empresa, pela API pública. */
  async function habilitarPlugin(token: string) {
    const instalacao = await requisicao({
      method: 'POST',
      url: `/api/v1/plugins/${PLUGIN}/install`,
      token,
      payload: { grantedPermissions: ['crm.customer.read'] },
    });
    expect(instalacao.statusCode).toBe(201);

    const configuracao = await requisicao({
      method: 'POST',
      url: `/api/v1/plugins/${PLUGIN}/configure`,
      token,
      payload: {
        config: { webhookUrl: urlDoDestino },
        secrets: { signingSecret: SEGREDO },
      },
    });
    expect(configuracao.statusCode).toBe(200);

    const habilitado = await requisicao({
      method: 'POST',
      url: `/api/v1/plugins/${PLUGIN}/enable`,
      token,
    });
    expect(habilitado.statusCode).toBe(200);
  }

  function comoMcp<T>(tenant: TenantSemeado, fn: () => Promise<T>): Promise<T> {
    const contexto = createContext('mcp');
    return runWithContext(contexto, () => {
      authenticateContext(contexto, {
        tenantId: toTenantId(tenant.tenantId),
        userId: toUserId(tenant.userId),
        actor: { kind: 'user', id: tenant.userId },
        permissions: ['*'],
        scopes: ['*'],
        entitlements: ['crm'],
      });
      return fn();
    });
  }

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());

    // Servidor que faz o papel do webhook da empresa.
    destino = createServer((requisicaoRecebida: IncomingMessage, resposta) => {
      let corpo = '';
      requisicaoRecebida.on('data', (parte) => (corpo += String(parte)));
      requisicaoRecebida.on('end', () => {
        recebidas.push({
          corpo,
          assinatura: requisicaoRecebida.headers[CABECALHO_ASSINATURA] as
            string | undefined,
          timestamp: requisicaoRecebida.headers[CABECALHO_TIMESTAMP] as
            string | undefined,
        });
        resposta.writeHead(204).end();
      });
    });
    await new Promise<void>((resolver) =>
      destino.listen(0, '127.0.0.1', resolver),
    );
    urlDoDestino = `http://127.0.0.1:${(destino.address() as AddressInfo).port}/hook`;

    process.env.DATABASE_URL = urlDaAplicacao();
    process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLATFORM_CORE)
      .useFactory({
        // A política padrão recusa a rede interna (é o que protege contra
        // SSRF); aqui o destino É local, então o teste injeta uma permissiva.
        // Que a padrão recusa está coberto no teste de unidade do plugin, e
        // o último caso deste arquivo prova que ela está de fato ligada.
        factory: () =>
          criarNucleo(loadEnv(), {
            politicaDeDestinoDeWebhook: () => Promise.resolve(),
          }),
      })
      .compile();

    app = modulo.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    registrarContextoDeRequisicao(app.getHttpAdapter().getInstance());
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    nucleo = app.get<NucleoDaPlataforma>(PLATFORM_CORE);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolver) => destino.close(() => resolver()));
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    recebidas = [];
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
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

  describe('catálogo e instalação', () => {
    it('lista o plugin disponível, ainda não instalado', async () => {
      const token = await entrar(empresaA);
      const resposta = await requisicao({
        method: 'GET',
        url: '/api/v1/plugins',
        token,
      });

      const { items } = resposta.json() as {
        items: { pluginId: string; installation: unknown }[];
      };
      expect(items.map((item) => item.pluginId)).toContain(PLUGIN);
      expect(
        items.find((item) => item.pluginId === PLUGIN)?.installation,
      ).toBeNull();
    });

    it('recusa conceder permissão que o manifesto não pede', async () => {
      const token = await entrar(empresaA);
      const resposta = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/install`,
        token,
        payload: { grantedPermissions: ['crm.customer.delete'] },
      });

      expect(resposta.statusCode).toBe(400);
    });

    it('não habilita antes de configurar', async () => {
      const token = await entrar(empresaA);
      await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/install`,
        token,
        payload: { grantedPermissions: [] },
      });

      const resposta = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/enable`,
        token,
      });
      expect(resposta.statusCode).toBe(409);
    });

    it('nunca devolve o valor do segredo, só a chave', async () => {
      const token = await entrar(empresaA);
      await habilitarPlugin(token);

      const resposta = await requisicao({
        method: 'GET',
        url: '/api/v1/plugins',
        token,
      });
      const bruto = JSON.stringify(resposta.json());

      expect(bruto).not.toContain(SEGREDO);
      expect(bruto).toContain('signingSecret');
    });
  });

  describe('capacidade do plugin', () => {
    it('entrega a mensagem assinada no webhook da empresa', async () => {
      const token = await entrar(empresaA);
      await habilitarPlugin(token);

      const resposta = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token,
        payload: { message: 'Pedido aprovado.' },
      });

      expect(resposta.statusCode).toBe(202);
      expect(recebidas).toHaveLength(1);

      const entrega = recebidas[0]!;
      const esperada = `v1=${createHmac('sha256', SEGREDO)
        .update(`${entrega.timestamp}.${entrega.corpo}`, 'utf8')
        .digest('hex')}`;
      expect(entrega.assinatura).toBe(esperada);
      expect(JSON.parse(entrega.corpo)).toMatchObject({
        tenantId: empresaA.tenantId,
        message: 'Pedido aprovado.',
      });
    });

    it('cita o cliente usando a permissão concedida na instalação', async () => {
      const token = await entrar(empresaA);
      await habilitarPlugin(token);

      const cliente = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Alfa' },
      });
      const { id } = cliente.json() as { id: string };

      const resposta = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token,
        payload: { message: 'Visita confirmada.', customerId: id },
      });

      expect(resposta.statusCode).toBe(202);
      expect(JSON.parse(recebidas[0]!.corpo)).toMatchObject({
        customer: { id, name: 'Construtora Alfa' },
      });
    });

    it('sem a permissão concedida, citar cliente é 403 — a rota continua valendo', async () => {
      const token = await entrar(empresaA);
      // Instala SEM conceder crm.customer.read.
      await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/install`,
        token,
        payload: { grantedPermissions: [] },
      });
      await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/configure`,
        token,
        payload: {
          config: { webhookUrl: urlDoDestino },
          secrets: { signingSecret: SEGREDO },
        },
      });
      await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/enable`,
        token,
      });

      const semCliente = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token,
        payload: { message: 'sem citar ninguém' },
      });
      expect(semCliente.statusCode).toBe(202);

      const comCliente = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token,
        payload: {
          message: 'citando',
          customerId: '55555555-5555-4555-8555-555555555555',
        },
      });
      expect(comCliente.statusCode).toBe(403);
    });

    it('a política padrão de destino recusa a rede interna', async () => {
      // Prova que o guarda anti-SSRF está LIGADO no caminho real: aqui o
      // núcleo é montado com a política de produção.
      const producao = criarNucleo(loadEnv());
      try {
        const runtime = {
          pluginId: PLUGIN,
          tenantId: empresaA.tenantId,
          actorId: empresaA.userId,
          config: { webhookUrl: urlDoDestino },
          grant: { permissions: [], scopes: [], entitlements: [] },
          segredo: () => SEGREDO,
        };
        await expect(
          producao.plugins.notificacoes.execute({
            runtime,
            message: 'não deve sair',
          }),
        ).rejects.toThrow(/rede interna|https/);
        expect(recebidas).toHaveLength(0);
      } finally {
        await producao.handle.close();
      }
    });
  });

  describe('isolamento entre empresas', () => {
    it('habilitar em A não libera nada em B — critério de aceite da fase', async () => {
      const tokenA = await entrar(empresaA);
      const tokenB = await entrar(empresaB);
      await habilitarPlugin(tokenA);

      const emA = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token: tokenA,
        payload: { message: 'de A' },
      });
      expect(emA.statusCode).toBe(202);

      const emB = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token: tokenB,
        payload: { message: 'de B' },
      });
      expect(emB.statusCode).toBe(403);
      expect(recebidas).toHaveLength(1);
    });

    it('desabilitar em A derruba a capacidade em A e não toca em B', async () => {
      const tokenA = await entrar(empresaA);
      const tokenB = await entrar(empresaB);
      await habilitarPlugin(tokenA);
      await habilitarPlugin(tokenB);

      await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/disable`,
        token: tokenA,
      });

      const emA = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token: tokenA,
        payload: { message: 'de A' },
      });
      expect(emA.statusCode).toBe(403);

      const emB = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token: tokenB,
        payload: { message: 'de B' },
      });
      expect(emB.statusCode).toBe(202);
    });

    it('a tool MCP do plugin só aparece para quem habilitou', async () => {
      const tokenA = await entrar(empresaA);
      await habilitarPlugin(tokenA);

      const grantA = await nucleo.tenancy.resolveUserAccess({
        tenantId: empresaA.tenantId,
        userId: empresaA.userId,
        scopes: ['*'],
      });
      const grantB = await nucleo.tenancy.resolveUserAccess({
        tenantId: empresaB.tenantId,
        userId: empresaB.userId,
        scopes: ['*'],
      });

      const nomes = (grant: typeof grantA) =>
        nucleo.mcp.toolsDe(grant).map((tool) => tool.name);

      expect(nomes(grantA)).toContain(
        'plugin.notifications-example.message.send',
      );
      expect(nomes(grantB)).not.toContain(
        'plugin.notifications-example.message.send',
      );
    });

    it('a tool MCP executa e entrega, com o tenant vindo do contexto', async () => {
      const tokenA = await entrar(empresaA);
      await habilitarPlugin(tokenA);

      const grantA = await nucleo.tenancy.resolveUserAccess({
        tenantId: empresaA.tenantId,
        userId: empresaA.userId,
        scopes: ['*'],
      });
      const tool = nucleo.mcp.acharTool(
        grantA,
        'plugin.notifications-example.message.send',
      );

      await comoMcp(empresaA, () =>
        tool.handle({ message: 'via agente' } as never, {
          tenantId: empresaA.tenantId,
          actorId: empresaA.userId,
        }),
      );

      expect(JSON.parse(recebidas[0]!.corpo)).toMatchObject({
        message: 'via agente',
        tenantId: empresaA.tenantId,
      });
    });
  });

  describe('desinstalação', () => {
    it('remove a instalação e os segredos', async () => {
      const token = await entrar(empresaA);
      await habilitarPlugin(token);

      const resposta = await requisicao({
        method: 'DELETE',
        url: `/api/v1/plugins/${PLUGIN}`,
        token,
      });
      expect(resposta.statusCode).toBe(204);

      const segredos = await dono`select * from plugin_secrets`;
      expect(segredos).toHaveLength(0);

      const depois = await requisicao({
        method: 'POST',
        url: `/api/v1/plugins/${PLUGIN}/messages`,
        token,
        payload: { message: 'não deve passar' },
      });
      expect(depois.statusCode).toBe(403);
    });
  });
});
