import type { AddressInfo } from 'node:net';

import { loadEnv } from '@ecojotaduo/config';
import { criarServicoDeCrm, type ServicoDeCrm } from '@ecojotaduo/crm-service';
import { runMigrations } from '@ecojotaduo/database';
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
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { prepararBordaHttp } from '../src/http/borda';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';

exigirBancoEmCI();

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

/**
 * Fase 12: o Comercial trabalhando com o CRM **fora do processo**.
 *
 * O teste de contrato (em `apps/crm-service`) prova que os dois adaptadores
 * respondem igual. Este prova o que interessa ao negócio: com
 * `CRM_SERVICE_URL` apontando para outro processo, o fluxo de proposta
 * continua exatamente o mesmo — inclusive a recusa quando o cliente não
 * existe, que é a regra que depende do CRM.
 *
 * Nenhum caso de uso, controller ou teste de negócio foi tocado para isto
 * funcionar. A única mudança é uma linha no composition root, escolhida por
 * variável de ambiente.
 */
describe.skipIf(!temBancoDeTeste)('Comercial com o CRM extraído (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let crm: ServicoDeCrm;
  let empresa: TenantSemeado;

  /**
   * Quantas chamadas o serviço extraído recebeu.
   *
   * Sem isto o teste não provaria nada: como o serviço roda contra o MESMO
   * banco, em processo e por HTTP dão exatamente a mesma resposta, e o teste
   * passaria mesmo se a chamada nunca saísse do monólito. O contador é a
   * evidência de que ela saiu.
   */
  let chamadasAoServico = 0;

  async function requisicao(opcoes: {
    method: 'GET' | 'POST';
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

  async function entrar(): Promise<string> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: empresa.email,
        password: empresa.senha,
        tenantSlug: empresa.slug,
      },
    });
    expect(resposta.statusCode).toBe(200);
    return (resposta.json() as { accessToken: string }).accessToken;
  }

  function daquiA(dias: number): string {
    return new Date(Date.now() + dias * 86_400_000).toISOString();
  }

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());

    process.env.DATABASE_URL = urlDaAplicacao();
    process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';

    // 1. O CRM sobe como processo próprio.
    //
    // Contra o MESMO banco, de propósito: numa extração real o processo se
    // separa antes dos dados (a borda REST do CRM iria junto, e só então as
    // tabelas mudam de casa). O teste do `crm-service` cobre o passo seguinte,
    // com banco separado.
    crm = criarServicoDeCrm(loadEnv());
    crm.app.addHook('onRequest', (requisicao, _resposta, feito) => {
      if (requisicao.url.startsWith('/internal/')) {
        chamadasAoServico += 1;
      }
      feito();
    });
    await crm.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = crm.app.server.address() as AddressInfo;

    // 2. E a plataforma passa a falar com ele por HTTP. Esta variável é a
    //    ÚNICA diferença entre este teste e o E2E comercial de sempre.
    process.env.CRM_SERVICE_URL = `http://127.0.0.1:${port}`;

    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await prepararBordaHttp(app);
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await crm?.app.close();
    await crm?.handle.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
    delete process.env.CRM_SERVICE_URL;
  });

  beforeEach(async () => {
    await dono`truncate table commercial_proposal_items, commercial_proposals, commercial_proposal_numbers cascade`;
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);
    chamadasAoServico = 0;
    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm', 'commercial'],
    });
  });

  it('a proposta é criada com o nome vindo do serviço extraído', async () => {
    const token = await entrar();

    const cliente = await requisicao({
      method: 'POST',
      url: '/api/v1/crm/customers',
      token,
      payload: { name: 'Construtora Alfa' },
    });
    expect(cliente.statusCode).toBe(201);
    const { id } = cliente.json() as { id: string };

    const proposta = await requisicao({
      method: 'POST',
      url: '/api/v1/commercial/proposals',
      token,
      payload: {
        customerId: id,
        title: 'Locação de equipamentos',
        currency: 'BRL',
        validUntil: daquiA(7),
        items: [
          {
            description: 'Escavadeira 20t — diária',
            quantity: 3,
            unitPriceCents: 150_000,
          },
        ],
      },
    });

    expect(proposta.statusCode).toBe(201);
    const criada = proposta.json() as { id: string; totalCents: number };
    expect(criada.totalCents).toBe(450_000);

    // O nome do cliente só aparece na leitura da proposta — e é ali que ele
    // atravessa a rede. O Comercial nunca leu a tabela do CRM; agora nem o
    // processo dele.
    const lida = await requisicao({
      method: 'GET',
      url: `/api/v1/commercial/proposals/${criada.id}`,
      token,
    });
    expect(lida.statusCode).toBe(200);
    expect((lida.json() as { customerName: string }).customerName).toBe(
      'Construtora Alfa',
    );

    // Duas idas ao serviço: uma para conferir a referência na criação, outra
    // para o nome na leitura. É isto que separa "passou" de "passou pela rede".
    expect(chamadasAoServico).toBe(2);
  });

  it('cliente inexistente continua sendo recusado — a regra não mudou', async () => {
    const token = await entrar();

    const proposta = await requisicao({
      method: 'POST',
      url: '/api/v1/commercial/proposals',
      token,
      payload: {
        customerId: '019a0000-0000-7000-8000-0000000000ff',
        title: 'Proposta órfã',
        currency: 'BRL',
        validUntil: daquiA(7),
        items: [{ description: 'item', quantity: 1, unitPriceCents: 1000 }],
      },
    });

    // A recusa vem do caso de uso do Comercial, como sempre veio (404, o
    // mesmo do E2E comercial). O que mudou foi de onde a resposta "não
    // existe" chegou — e ela chegou mesmo, pela rede.
    expect(proposta.statusCode).toBe(404);
    expect(chamadasAoServico).toBe(1);
  });

  it('cliente de OUTRA empresa não vira proposta válida', async () => {
    const outra = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm', 'commercial'],
    });
    const tokenDaOutra = await (async () => {
      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: outra.email,
          password: outra.senha,
          tenantSlug: outra.slug,
        },
      });
      return (resposta.json() as { accessToken: string }).accessToken;
    })();

    const cliente = await requisicao({
      method: 'POST',
      url: '/api/v1/crm/customers',
      token: tokenDaOutra,
      payload: { name: 'Cliente da Empresa B' },
    });
    const { id } = cliente.json() as { id: string };

    // A empresa A tenta usar o cliente da B. O isolamento agora atravessa
    // processo: a empresa vai no token interno, e o serviço não devolve o que
    // não é dela.
    const token = await entrar();
    const proposta = await requisicao({
      method: 'POST',
      url: '/api/v1/commercial/proposals',
      token,
      payload: {
        customerId: id,
        title: 'Proposta invasora',
        currency: 'BRL',
        validUntil: daquiA(7),
        items: [{ description: 'item', quantity: 1, unitPriceCents: 1000 }],
      },
    });

    expect(proposta.statusCode).toBe(404);
  });
});
