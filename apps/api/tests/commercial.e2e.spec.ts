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
import { prepararBordaHttp } from '../src/http/borda';

exigirBancoEmCI();

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

interface PropostaJson {
  id: string;
  number: number;
  status: string;
  storedStatus: string;
  totalCents: number;
  currency: string;
  customerName: string | null;
  items: { totalCents: number }[];
}

function daquiA(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fase 7 ponta a ponta, primeiro vertical: proposta comercial.
 *
 * O teste central é o bloco final: a MESMA decisão de negócio tomada por REST
 * e pela tool MCP passa pelas mesmas invariantes — inclusive a recusa de uma
 * proposta vencida.
 */
describe.skipIf(!temBancoDeTeste)('Comercial (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let nucleo: NucleoDaPlataforma;
  let empresa: TenantSemeado;
  let semComercial: TenantSemeado;

  async function requisicao(opcoes: {
    method: 'GET' | 'POST' | 'PATCH';
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

  async function criarCliente(token: string): Promise<string> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/crm/customers',
      token,
      payload: { name: 'Construtora Alfa' },
    });
    expect(resposta.statusCode).toBe(201);
    return (resposta.json() as { id: string }).id;
  }

  async function criarProposta(
    token: string,
    customerId: string,
    validUntil = daquiA(7),
  ): Promise<PropostaJson> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/commercial/proposals',
      token,
      payload: {
        customerId,
        title: 'Locação de equipamentos',
        currency: 'BRL',
        validUntil,
        items: [
          {
            description: 'Escavadeira 20t — diária',
            quantity: 3,
            unitPriceCents: 150_000,
          },
        ],
      },
    });
    expect(resposta.statusCode).toBe(201);
    return resposta.json() as PropostaJson;
  }

  function comoMcp<T>(fn: () => Promise<T>): Promise<T> {
    const contexto = createContext('mcp');
    return runWithContext(contexto, () => {
      authenticateContext(contexto, {
        tenantId: toTenantId(empresa.tenantId),
        userId: toUserId(empresa.userId),
        actor: { kind: 'user', id: empresa.userId },
        permissions: ['*'],
        scopes: ['*'],
        entitlements: ['crm', 'commercial'],
      });
      return fn();
    });
  }

  const GRANT = {
    permissions: ['*'],
    scopes: ['*'],
    entitlements: ['crm', 'commercial'],
  };

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());

    process.env.DATABASE_URL = urlDaAplicacao();
    process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';

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

    nucleo = app.get<NucleoDaPlataforma>(PLATFORM_CORE);
  });

  afterAll(async () => {
    await app?.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table commercial_proposal_items, commercial_proposals, commercial_proposal_numbers cascade`;
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm', 'commercial'],
    });
    // CRM contratado, Comercial não.
    semComercial = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm'],
    });
  });

  describe('fluxo comercial', () => {
    it('elabora, envia e fecha a proposta', async () => {
      const token = await entrar(empresa);
      const customerId = await criarCliente(token);
      const proposta = await criarProposta(token, customerId);

      expect(proposta.number).toBe(1);
      expect(proposta.status).toBe('draft');
      expect(proposta.totalCents).toBe(450_000);

      const enviada = await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposta.id}/send`,
        token,
      });
      expect(enviada.statusCode).toBe(200);
      expect((enviada.json() as PropostaJson).status).toBe('sent');

      const aceita = await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposta.id}/accept`,
        token,
      });
      expect(aceita.statusCode).toBe(200);
      expect((aceita.json() as PropostaJson).status).toBe('accepted');
    });

    it('o total é do servidor: mandar um total na entrada não muda nada', async () => {
      const token = await entrar(empresa);
      const customerId = await criarCliente(token);

      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/commercial/proposals',
        token,
        payload: {
          customerId,
          title: 'Tentativa de total próprio',
          currency: 'BRL',
          validUntil: daquiA(7),
          totalCents: 1, // não existe no schema — é ignorado
          items: [{ description: 'Item', quantity: 2, unitPriceCents: 10_000 }],
        },
      });

      expect(resposta.statusCode).toBe(201);
      expect((resposta.json() as PropostaJson).totalCents).toBe(20_000);
    });

    it('não altera proposta já enviada', async () => {
      const token = await entrar(empresa);
      const customerId = await criarCliente(token);
      const proposta = await criarProposta(token, customerId);

      await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposta.id}/send`,
        token,
      });

      const alteracao = await requisicao({
        method: 'PATCH',
        url: `/api/v1/commercial/proposals/${proposta.id}`,
        token,
        payload: { title: 'Preço novo' },
      });
      expect(alteracao.statusCode).toBe(409);
    });

    it('recusa proposta para cliente de outra empresa', async () => {
      const tokenA = await entrar(empresa);
      const tokenB = await entrar(semComercial);
      const clienteDeB = await criarCliente(tokenB);

      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/commercial/proposals',
        token: tokenA,
        payload: {
          customerId: clienteDeB,
          title: 'Proposta indevida',
          currency: 'BRL',
          validUntil: daquiA(7),
        },
      });
      expect(resposta.statusCode).toBe(404);
    });

    it('traz o nome do cliente na leitura, sem o Comercial tocar as tabelas do CRM', async () => {
      const token = await entrar(empresa);
      const customerId = await criarCliente(token);
      const proposta = await criarProposta(token, customerId);

      const resposta = await requisicao({
        method: 'GET',
        url: `/api/v1/commercial/proposals/${proposta.id}`,
        token,
      });
      expect((resposta.json() as PropostaJson).customerName).toBe(
        'Construtora Alfa',
      );
    });
  });

  describe('módulo contratado', () => {
    it('empresa sem o Comercial não acessa a rota', async () => {
      const token = await entrar(semComercial);
      const resposta = await requisicao({
        method: 'GET',
        url: '/api/v1/commercial/proposals',
        token,
      });
      expect(resposta.statusCode).toBe(403);
    });

    it('e também não enxerga as tools do Comercial', async () => {
      const grant = await nucleo.tenancy.resolveUserAccess({
        tenantId: semComercial.tenantId,
        userId: semComercial.userId,
        scopes: ['*'],
      });
      const nomes = nucleo.mcp.toolsDe(grant).map((tool) => tool.name);

      expect(nomes.some((nome) => nome.startsWith('commercial.'))).toBe(false);
      expect(nomes).toContain('crm.customer.search');
    });
  });

  describe('REST e MCP executam o mesmo caso de uso', () => {
    it('a tool de aprovação fecha a proposta criada pelo REST', async () => {
      const token = await entrar(empresa);
      const customerId = await criarCliente(token);
      const proposta = await criarProposta(token, customerId);
      await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposta.id}/send`,
        token,
      });

      const tool = nucleo.mcp.acharTool(GRANT, 'commercial.proposal.approve');
      const resultado = (await comoMcp(() =>
        tool.handle({ proposalId: proposta.id, decision: 'accept' } as never, {
          tenantId: empresa.tenantId,
          actorId: empresa.userId,
        }),
      )) as PropostaJson;

      expect(resultado.status).toBe('accepted');

      // E o REST enxerga o mesmo estado: uma persistência só.
      const relida = await requisicao({
        method: 'GET',
        url: `/api/v1/commercial/proposals/${proposta.id}`,
        token,
      });
      expect((relida.json() as PropostaJson).status).toBe('accepted');
    });

    it('a tool respeita a MESMA recusa de proposta vencida', async () => {
      const token = await entrar(empresa);
      const customerId = await criarCliente(token);
      // Validade curta: envia dentro do prazo e decide depois de vencer.
      const proposta = await criarProposta(
        token,
        customerId,
        new Date(Date.now() + 1_500).toISOString(),
      );
      await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposta.id}/send`,
        token,
      });

      await new Promise((resolver) => setTimeout(resolver, 1_800));

      const tool = nucleo.mcp.acharTool(GRANT, 'commercial.proposal.approve');
      await expect(
        comoMcp(() =>
          tool.handle(
            { proposalId: proposta.id, decision: 'accept' } as never,
            { tenantId: empresa.tenantId, actorId: empresa.userId },
          ),
        ),
      ).rejects.toThrow(/venceu/i);

      // Pela borda REST, o mesmo não.
      const pelaRota = await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposta.id}/accept`,
        token,
      });
      expect(pelaRota.statusCode).toBe(409);

      // E a leitura mostra vencida, sem job nenhum ter rodado.
      const relida = await requisicao({
        method: 'GET',
        url: `/api/v1/commercial/proposals/${proposta.id}`,
        token,
      });
      const corpo = relida.json() as PropostaJson;
      expect(corpo.status).toBe('expired');
      expect(corpo.storedStatus).toBe('sent');
    });
  });

  describe('auditoria', () => {
    it('registra o valor fechado na trilha', async () => {
      const token = await entrar(empresa);
      const customerId = await criarCliente(token);
      const proposta = await criarProposta(token, customerId);
      await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposta.id}/send`,
        token,
      });
      await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposta.id}/accept`,
        token,
      });

      const trilha = await dono<{ metadata: Record<string, unknown> }[]>`
        select metadata from audit_events
        where tenant_id = ${empresa.tenantId}
          and action = 'commercial.proposal.accepted'
      `;
      expect(trilha).toHaveLength(1);
      expect(trilha[0]?.metadata).toMatchObject({
        totalCents: 450_000,
        currency: 'BRL',
      });
    });
  });
});
