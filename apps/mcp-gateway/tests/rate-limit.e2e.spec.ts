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
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { criarGateway, ROTA_MCP, type Gateway } from '../src/gateway';

exigirBancoEmCI();

/** Teto baixo: o teste precisa estourar o limite, não esperar um minuto. */
const MAX_MCP = 4;

/**
 * Fase 10: limite por credencial no gateway MCP.
 *
 * O risco aqui não é força bruta, é **agente em laço**: um host que erre a
 * condição de parada bate na mesma tool centenas de vezes por minuto, e cada
 * chamada resolve acesso e consulta o banco. Não é ataque — é defeito de quem
 * integra, e ainda assim derruba a plataforma para as outras empresas.
 *
 * Por isso o balde é da credencial: o laço de um agente não pode consumir a
 * franquia de outra empresa.
 */
describe.skipIf(!temBancoDeTeste)('limite do gateway MCP (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let gateway: Gateway;
  let nucleo: NucleoDaPlataforma;
  let endereco: string;
  let empresa: TenantSemeado;
  let outra: TenantSemeado;

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

  /** Uma chamada MCP crua: o cliente oficial abre stream e complica a contagem. */
  async function chamar(token: string): Promise<number> {
    const resposta = await gateway.app.inject({
      method: 'POST',
      url: ROTA_MCP,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'teste', version: '0.0.0' },
        },
      },
    });
    return resposta.statusCode;
  }

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());

    process.env.DATABASE_URL = urlDaAplicacao();
    process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_MCP_MAX = String(MAX_MCP);
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';

    gateway = await criarGateway(loadEnv());
    nucleo = gateway.nucleo;
    await gateway.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = gateway.app.server.address() as AddressInfo;
    endereco = `http://127.0.0.1:${port}${ROTA_MCP}`;
  });

  afterAll(async () => {
    await gateway?.app.close();
    await nucleo?.handle.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
    delete process.env.RATE_LIMIT_MCP_MAX;
    delete process.env.RATE_LIMIT_WINDOW_SECONDS;
  });

  beforeEach(async () => {
    await limparDados(dono);
    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });
    outra = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm'],
    });
  });

  it('agente em laço é barrado depois do teto', async () => {
    const token = await entrar(empresa);

    for (let chamada = 0; chamada < MAX_MCP; chamada += 1) {
      expect(await chamar(token)).not.toBe(429);
    }
    expect(await chamar(token)).toBe(429);
  });

  it('o laço de uma credencial não consome a franquia de outra', async () => {
    const daEmpresa = await entrar(empresa);
    const daOutra = await entrar(outra);

    for (let chamada = 0; chamada <= MAX_MCP; chamada += 1) {
      await chamar(daEmpresa);
    }
    expect(await chamar(daEmpresa)).toBe(429);

    // Mesmo processo, mesmo endereço: só a credencial estourada é barrada.
    expect(await chamar(daOutra)).not.toBe(429);
  });

  it('a recusa é 429 com corpo JSON-RPC, e não 500', async () => {
    const token = await entrar(empresa);
    for (let chamada = 0; chamada <= MAX_MCP; chamada += 1) {
      await chamar(token);
    }

    const resposta = await gateway.app.inject({
      method: 'POST',
      url: ROTA_MCP,
      headers: { authorization: `Bearer ${token}` },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });

    // 500 diria "o servidor quebrou" quando ele está se protegendo — o host
    // precisa saber que a resposta certa é esperar, não repetir.
    expect(resposta.statusCode).toBe(429);
    const corpo: { error?: { message?: string } } = resposta.json();
    expect(corpo.error?.message).toContain('Limite de chamadas');
  });

  it('o health check não gasta franquia', async () => {
    for (let chamada = 0; chamada < MAX_MCP + 5; chamada += 1) {
      const resposta = await gateway.app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(resposta.statusCode).toBe(200);
    }
    expect(endereco).toContain('/mcp');
  });
});
