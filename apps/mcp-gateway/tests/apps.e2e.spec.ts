import type { AddressInfo } from 'node:net';

import { loadEnv } from '@ecojotaduo/config';
import { runMigrations } from '@ecojotaduo/database';
import type { NucleoDaPlataforma } from '@ecojotaduo/platform-core';
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
import { createContext, runWithContext } from '@ecojotaduo/tenant-context';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type postgres from 'postgres';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from '../src/apps';
import { criarGateway, type Gateway } from '../src/gateway';

exigirBancoEmCI();

const URI_DO_PATIO = 'ui://assets/patio.html';

/**
 * Fase 9: MCP Apps, com o CLIENTE OFICIAL do MCP.
 *
 * O critério de aceite da fase é o primeiro bloco: **um host sem suporte a
 * Apps continua usando a tool estruturada**. A interface é sugestão; nenhuma
 * decisão de negócio depende de ela ter sido renderizada.
 */
describe.skipIf(!temBancoDeTeste)('MCP Apps (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let gateway: Gateway;
  let nucleo: NucleoDaPlataforma;
  let endereco: string;

  let empresa: TenantSemeado;
  let semAtivos: TenantSemeado;
  /** Cada conexão MCP segura um stream aberto; sem fechar, o servidor não para. */
  const conectados: Client[] = [];

  async function entrar(tenant: TenantSemeado): Promise<string> {
    const sessao = await runWithContext(createContext('system'), () =>
      nucleo.signIn.execute({
        email: tenant.email,
        password: tenant.senha,
        tenantSlug: tenant.slug,
      }),
    );
    return sessao.accessToken;
  }

  async function conectarComo(tenant: TenantSemeado): Promise<Client> {
    const token = await entrar(tenant);
    const cliente = new Client({ name: 'teste', version: '0.0.0' });
    await cliente.connect(
      new StreamableHTTPClientTransport(new URL(endereco), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    conectados.push(cliente);
    return cliente;
  }

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());

    process.env.DATABASE_URL = urlDaAplicacao();
    process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';

    gateway = criarGateway(loadEnv());
    nucleo = gateway.nucleo;
    await gateway.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = gateway.app.server.address() as AddressInfo;
    endereco = `http://127.0.0.1:${port}/mcp`;
  });

  afterEach(async () => {
    await Promise.all(conectados.splice(0).map((cliente) => cliente.close()));
  });

  afterAll(async () => {
    await gateway?.app.close();
    await nucleo?.handle.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table platform_outbox cascade`;
    await dono`truncate table assets_asset_holds, assets_assets cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['assets'],
    });
    // Mesma plataforma, sem o módulo Ativos contratado.
    semAtivos = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: [],
    });
  });

  /** `contents[]` é união de texto|blob; o app é sempre texto. */
  async function documentoDoPatio(cliente: Client): Promise<string> {
    const { contents } = await cliente.readResource({ uri: URI_DO_PATIO });
    const primeiro = contents[0];
    return primeiro && 'text' in primeiro ? String(primeiro.text) : '';
  }

  async function cadastrarEquipamento(cliente: Client, code: string) {
    const resultado = await cliente.callTool({
      name: 'assets.asset.register',
      arguments: { code, name: 'Escavadeira 20t', category: 'escavadeira' },
    });
    expect(resultado.isError, JSON.stringify(resultado.content)).toBeFalsy();
  }

  describe('a interface é sugestão, não requisito', () => {
    it('a tool devolve o resultado de sempre em `content`', async () => {
      const cliente = await conectarComo(empresa);
      await cadastrarEquipamento(cliente, 'ESC-014');

      const resultado = await cliente.callTool({
        name: 'assets.asset.search',
        arguments: {},
      });

      // É isto que um host sem suporte a Apps lê — e é suficiente.
      const conteudo = (resultado as { content: { text?: string }[] }).content;
      const dados = JSON.parse(conteudo[0]?.text ?? '{}') as {
        items: { code: string; availability: string }[];
        total: number;
      };
      expect(dados.total).toBe(1);
      expect(dados.items[0]?.code).toBe('ESC-014');
      expect(dados.items[0]?.availability).toBe('available');
    });

    it('o mesmo resultado vem em `structuredContent`, para a interface', async () => {
      const cliente = await conectarComo(empresa);
      await cadastrarEquipamento(cliente, 'ESC-014');

      const resultado = await cliente.callTool({
        name: 'assets.asset.search',
        arguments: {},
      });

      // A interface não busca nada por conta própria: ela desenha o que a
      // tool já devolveu. Duas leituras seriam duas verdades.
      const estruturado = (
        resultado as { structuredContent?: { total?: number } }
      ).structuredContent;
      expect(estruturado?.total).toBe(1);
    });

    it('a tool aponta para a interface no `_meta`', async () => {
      const cliente = await conectarComo(empresa);
      const { tools } = await cliente.listTools();
      const busca = tools.find((tool) => tool.name === 'assets.asset.search');

      expect(busca?._meta?.[RESOURCE_URI_META_KEY]).toBe(URI_DO_PATIO);
      // As demais tools do módulo não têm interface, e não fingem ter.
      const get = tools.find((tool) => tool.name === 'assets.asset.get');
      expect(get?._meta?.[RESOURCE_URI_META_KEY]).toBeUndefined();
    });
  });

  describe('descoberta e leitura da interface', () => {
    it('a interface aparece em `resources/list` com o mime do protocolo', async () => {
      const cliente = await conectarComo(empresa);
      const { resources } = await cliente.listResources();
      const patio = resources.find((recurso) => recurso.uri === URI_DO_PATIO);

      expect(patio?.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect(patio?.name).toBe('assets.asset.board');
    });

    it('o documento vem com CSP fechada e o runtime embutido', async () => {
      const cliente = await conectarComo(empresa);
      const html = await documentoDoPatio(cliente);

      // `default-src 'none'` é o que separa uma tela de um canal de saída.
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("connect-src 'none'");
      expect(html).toContain("form-action 'none'");
      // Runtime embutido: buscar de CDN seria uma requisição que a própria
      // CSP (corretamente) barra.
      expect(html).toContain('new App()');
      expect(html).toContain('await app.connect()');
      expect(html.length).toBeGreaterThan(100_000);
      // E o corpo que o módulo declarou está lá.
      expect(html).toContain('Pátio de equipamentos');
      expect(html).toContain('app.ontoolresult');
    });

    it('o documento não abre domínio nenhum sem o app pedir', async () => {
      const cliente = await conectarComo(empresa);
      const html = await documentoDoPatio(cliente);

      const csp = /content="([^"]*default-src[^"]*)"/.exec(html)?.[1] ?? '';
      expect(csp).not.toMatch(/connect-src[^;]*https?:/);
      expect(csp).not.toContain('*');
    });
  });

  describe('a interface segue a mesma autorização das outras capacidades', () => {
    it('empresa sem o módulo não lista nem lê a interface', async () => {
      const cliente = await conectarComo(semAtivos);

      expect((await cliente.listResources()).resources).toEqual([]);
      // Nem com a URI em mãos: descoberta e leitura passam pela mesma decisão.
      await expect(
        cliente.readResource({ uri: URI_DO_PATIO }),
      ).rejects.toThrow();
    });

    it('empresa sem o módulo também não recebe o `_meta` da interface', async () => {
      const cliente = await conectarComo(semAtivos);
      const { tools } = await cliente.listTools();

      expect(tools.some((tool) => tool.name.startsWith('assets.'))).toBe(false);
    });

    it('URI de interface inexistente é recusada', async () => {
      const cliente = await conectarComo(empresa);
      await expect(
        cliente.readResource({ uri: 'ui://assets/inventada.html' }),
      ).rejects.toThrow();
    });
  });
});
