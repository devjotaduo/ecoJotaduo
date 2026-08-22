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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { criarGateway, type Gateway } from '../src/gateway';

exigirBancoEmCI();

/**
 * Token pessoal no gateway MCP.
 *
 * Esta suíte existe por causa de um defeito que só apareceu rodando: o token
 * pessoal foi construído PARA o host MCP, mas a leitura da credencial vivia
 * dentro do guard da API. O REST aceitava; o gateway respondia 401 — a única
 * borda que o recurso precisava atender.
 *
 * Nenhum teste pegava isso porque os do token pessoal estavam todos em
 * `apps/api`. A correção foi mover a leitura para `@ecojotaduo/platform-core`,
 * onde as duas bordas a compartilham; este arquivo é o que impede a volta.
 */
describe.skipIf(!temBancoDeTeste)('token pessoal no gateway MCP (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let gateway: Gateway;
  let nucleo: NucleoDaPlataforma;
  let endereco: string;
  let empresa: TenantSemeado;

  async function emitirTokenPessoal(
    tenant: TenantSemeado,
    scopes: readonly string[] = ['*'],
  ): Promise<{ id: string; token: string }> {
    const emitido = await runWithContext(createContext('system'), () =>
      nucleo.tokensPessoais.issue({
        userId: tenant.userId,
        tenantId: tenant.tenantId,
        name: 'agente do teste',
        scopes,
      }),
    );
    return { id: emitido.id, token: emitido.token };
  }

  /** Conecta como o host MCP conectaria: cabeçalho fixo, sem login. */
  async function conectar(token: string): Promise<Client> {
    const cliente = new Client({ name: 'teste', version: '0.0.0' });
    await cliente.connect(
      new StreamableHTTPClientTransport(new URL(endereco), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
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

    gateway = await criarGateway(loadEnv());
    nucleo = gateway.nucleo;
    await gateway.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = gateway.app.server.address() as AddressInfo;
    endereco = `http://127.0.0.1:${port}/mcp`;
  });

  afterAll(async () => {
    await gateway?.app.close();
    await nucleo?.handle.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table identity_personal_access_tokens cascade`;
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-mcp',
      email: 'ana@empresa-mcp.com.br',
      modulos: ['crm'],
    });
  });

  it('o host conecta e descobre as capacidades da empresa', async () => {
    const { token } = await emitirTokenPessoal(empresa);
    const cliente = await conectar(token);

    const { tools } = await cliente.listTools();

    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((tool) => tool.name)).toContain('crm.customer.create');
    await cliente.close();
  });

  it('e executa, agindo como a PESSOA dona do token', async () => {
    const { token } = await emitirTokenPessoal(empresa);
    const cliente = await conectar(token);

    const resultado = await cliente.callTool({
      name: 'crm.customer.create',
      arguments: { name: 'Cliente pelo agente', document: null },
    });

    expect(resultado.isError, JSON.stringify(resultado.content)).toBeFalsy();

    const [trilha] = await dono<{ actor_id: string; channel: string }[]>`
      select actor_id, channel from audit_events
       where tenant_id = ${empresa.tenantId}
         and action = 'crm.customer.created'
    `;
    // A trilha aponta a pessoa, não uma conta de serviço — é o que se perderia
    // com uma credencial compartilhada.
    expect(trilha?.actor_id).toBe(empresa.userId);
    expect(trilha?.channel).toBe('mcp');
    await cliente.close();
  });

  it('`scopes` é teto: recortar some com a tool nas duas pontas', async () => {
    const { token } = await emitirTokenPessoal(empresa, ['crm.customer.read']);
    const cliente = await conectar(token);

    const { tools } = await cliente.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain('crm.customer.create');

    // Descoberta e execução passam pela MESMA decisão: adivinhar o nome não
    // ajuda quem não pode executar.
    await expect(
      cliente.callTool({
        name: 'crm.customer.create',
        arguments: { name: 'Tentativa', document: null },
      }),
    ).rejects.toThrow();
    await cliente.close();
  });

  it('revogar vale na conexão seguinte', async () => {
    const { id, token } = await emitirTokenPessoal(empresa);
    const antes = await conectar(token);
    expect((await antes.listTools()).tools.length).toBeGreaterThan(0);
    await antes.close();

    await runWithContext(createContext('system'), () =>
      nucleo.tokensPessoais.revoke({
        tokenId: id,
        userId: empresa.userId,
        tenantId: empresa.tenantId,
      }),
    );

    // Não há cache de credencial: o acesso é resolvido do banco a cada
    // requisição, então revogar não espera o token expirar.
    await expect(conectar(token)).rejects.toThrow();
  });

  it('token pessoal inventado é recusado como credencial, não como erro interno', async () => {
    await expect(conectar('ecj_pat_naoexisteesteaqui')).rejects.toThrow();
  });
});
