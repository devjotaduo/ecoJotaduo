import { runMigrations } from '@ecojotaduo/database';
import type { NucleoDaPlataforma } from '@ecojotaduo/platform-core';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  reservarBancoDeTestes,
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

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

interface ContratoJson {
  id: string;
  number: number;
  customerId: string;
  proposalId: string;
  title: string;
  status: string;
  storedStatus: string;
  inForce: boolean;
  valueCents: number;
  currency: string;
}

const MODULOS = ['crm', 'commercial', 'contracts'];

function daquiA(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fase 7, segundo vertical: a cadeia CRM → Comercial → Contratos ponta a ponta.
 *
 * O teste central é o primeiro bloco: um contrato só nasce de uma proposta que
 * o cliente aceitou, e o valor dele vem da proposta — não de quem formaliza.
 */
describe.skipIf(!temBancoDeTeste)('Contratos (E2E)', () => {
  let dono: postgres.Sql;
  let liberarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let nucleo: NucleoDaPlataforma;
  let empresa: TenantSemeado;
  let semContratos: TenantSemeado;

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

  /** Percorre CRM → Comercial até a proposta aceita. */
  async function propostaAceita(token: string): Promise<string> {
    const cliente = await requisicao({
      method: 'POST',
      url: '/api/v1/crm/customers',
      token,
      payload: { name: 'Construtora Alfa' },
    });
    const { id: customerId } = cliente.json() as { id: string };

    const proposta = await requisicao({
      method: 'POST',
      url: '/api/v1/commercial/proposals',
      token,
      payload: {
        customerId,
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
    const { id: proposalId } = proposta.json() as { id: string };

    await requisicao({
      method: 'POST',
      url: `/api/v1/commercial/proposals/${proposalId}/send`,
      token,
    });
    const aceita = await requisicao({
      method: 'POST',
      url: `/api/v1/commercial/proposals/${proposalId}/accept`,
      token,
    });
    expect(aceita.statusCode).toBe(200);

    return proposalId;
  }

  async function formalizar(
    token: string,
    proposalId: string,
  ): Promise<RespostaHttp> {
    return requisicao({
      method: 'POST',
      url: '/api/v1/contracts',
      token,
      payload: {
        proposalId,
        startsOn: daquiA(1),
        endsOn: daquiA(90),
      },
    });
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
        entitlements: MODULOS,
      });
      return fn();
    });
  }

  const GRANT = { permissions: ['*'], scopes: ['*'], entitlements: MODULOS };

  beforeAll(async () => {
    liberarBanco = await reservarBancoDeTestes();
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
    registrarContextoDeRequisicao(app.getHttpAdapter().getInstance());
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    nucleo = app.get<NucleoDaPlataforma>(PLATFORM_CORE);
  });

  afterAll(async () => {
    await app?.close();
    await dono.end({ timeout: 5 });
    await liberarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table contracts_contracts, contracts_contract_numbers cascade`;
    await dono`truncate table commercial_proposal_items, commercial_proposals, commercial_proposal_numbers cascade`;
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: MODULOS,
    });
    // Comercial contratado, Contratos não.
    semContratos = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm', 'commercial'],
    });
  });

  describe('a cadeia CRM → Comercial → Contratos', () => {
    it('formaliza o contrato com os dados da proposta aceita', async () => {
      const token = await entrar(empresa);
      const proposalId = await propostaAceita(token);

      const resposta = await formalizar(token, proposalId);
      expect(resposta.statusCode).toBe(201);

      const contrato = resposta.json() as ContratoJson;
      // Valor e título NÃO foram informados: vieram da proposta.
      expect(contrato.valueCents).toBe(450_000);
      expect(contrato.title).toBe('Locação de equipamentos');
      expect(contrato.proposalId).toBe(proposalId);
      expect(contrato.number).toBe(1);
      expect(contrato.status).toBe('draft');
    });

    it('recusa formalizar proposta que o cliente não aceitou', async () => {
      const token = await entrar(empresa);
      const cliente = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Beta' },
      });
      const proposta = await requisicao({
        method: 'POST',
        url: '/api/v1/commercial/proposals',
        token,
        payload: {
          customerId: (cliente.json() as { id: string }).id,
          title: 'Só rascunho',
          currency: 'BRL',
          validUntil: daquiA(7),
          items: [{ description: 'Item', quantity: 1, unitPriceCents: 1000 }],
        },
      });

      const resposta = await formalizar(
        token,
        (proposta.json() as { id: string }).id,
      );
      expect(resposta.statusCode).toBe(409);
    });

    it('uma proposta vira um contrato só', async () => {
      const token = await entrar(empresa);
      const proposalId = await propostaAceita(token);

      expect((await formalizar(token, proposalId)).statusCode).toBe(201);
      expect((await formalizar(token, proposalId)).statusCode).toBe(409);
    });

    it('não formaliza proposta de outra empresa', async () => {
      const tokenA = await entrar(empresa);
      const tokenB = await entrar(semContratos);
      const propostaDeB = await propostaAceita(tokenB);

      const resposta = await formalizar(tokenA, propostaDeB);
      expect(resposta.statusCode).toBe(404);
    });
  });

  describe('vigência', () => {
    it('ativa e passa a estar em vigor no início', async () => {
      const token = await entrar(empresa);
      const proposalId = await propostaAceita(token);
      const criado = (
        await formalizar(token, proposalId)
      ).json() as ContratoJson;

      const ativo = await requisicao({
        method: 'POST',
        url: `/api/v1/contracts/${criado.id}/activate`,
        token,
      });
      expect(ativo.statusCode).toBe(200);

      const corpo = ativo.json() as ContratoJson;
      expect(corpo.status).toBe('active');
      // Ativado hoje, mas a vigência começa amanhã.
      expect(corpo.inForce).toBe(false);
    });

    it('recusa vigência com término antes do início', async () => {
      const token = await entrar(empresa);
      const proposalId = await propostaAceita(token);

      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/contracts',
        token,
        payload: {
          proposalId,
          startsOn: daquiA(90),
          endsOn: daquiA(1),
        },
      });
      expect(resposta.statusCode).toBe(400);
    });

    it('encerra o contrato ativo com motivo', async () => {
      const token = await entrar(empresa);
      const proposalId = await propostaAceita(token);
      const criado = (
        await formalizar(token, proposalId)
      ).json() as ContratoJson;
      await requisicao({
        method: 'POST',
        url: `/api/v1/contracts/${criado.id}/activate`,
        token,
      });

      const encerrado = await requisicao({
        method: 'POST',
        url: `/api/v1/contracts/${criado.id}/finish`,
        token,
        payload: { reason: 'entrega concluída' },
      });
      expect(encerrado.statusCode).toBe(200);
      expect((encerrado.json() as ContratoJson).status).toBe('finished');
    });

    it('não encerra o que ainda está em rascunho', async () => {
      const token = await entrar(empresa);
      const proposalId = await propostaAceita(token);
      const criado = (
        await formalizar(token, proposalId)
      ).json() as ContratoJson;

      const resposta = await requisicao({
        method: 'POST',
        url: `/api/v1/contracts/${criado.id}/finish`,
        token,
        payload: {},
      });
      expect(resposta.statusCode).toBe(409);
    });
  });

  describe('módulo contratado', () => {
    it('empresa sem Contratos não acessa a rota nem enxerga as tools', async () => {
      const token = await entrar(semContratos);
      const rota = await requisicao({
        method: 'GET',
        url: '/api/v1/contracts',
        token,
      });
      expect(rota.statusCode).toBe(403);

      const grant = await nucleo.tenancy.resolveUserAccess({
        tenantId: semContratos.tenantId,
        userId: semContratos.userId,
        scopes: ['*'],
      });
      const nomes = nucleo.mcp.toolsDe(grant).map((tool) => tool.name);

      expect(nomes.some((nome) => nome.startsWith('contracts.'))).toBe(false);
      // Mas o Comercial, que ela contratou, continua lá.
      expect(nomes).toContain('commercial.proposal.approve');
    });
  });

  describe('REST e MCP executam o mesmo caso de uso', () => {
    it('a tool formaliza o contrato e o REST enxerga o mesmo estado', async () => {
      const token = await entrar(empresa);
      const proposalId = await propostaAceita(token);

      const tool = nucleo.mcp.acharTool(GRANT, 'contracts.contract.create');
      const contrato = (await comoMcp(() =>
        tool.handle(
          { proposalId, startsOn: daquiA(1), endsOn: daquiA(90) } as never,
          { tenantId: empresa.tenantId, actorId: empresa.userId },
        ),
      )) as ContratoJson;

      expect(contrato.valueCents).toBe(450_000);

      const pelaRota = await requisicao({
        method: 'GET',
        url: `/api/v1/contracts/${contrato.id}`,
        token,
      });
      expect((pelaRota.json() as ContratoJson).number).toBe(contrato.number);
    });

    it('a tool respeita a MESMA recusa de proposta não aceita', async () => {
      const token = await entrar(empresa);
      const cliente = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Gama' },
      });
      const proposta = await requisicao({
        method: 'POST',
        url: '/api/v1/commercial/proposals',
        token,
        payload: {
          customerId: (cliente.json() as { id: string }).id,
          title: 'Rascunho',
          currency: 'BRL',
          validUntil: daquiA(7),
          items: [{ description: 'Item', quantity: 1, unitPriceCents: 1000 }],
        },
      });

      const tool = nucleo.mcp.acharTool(GRANT, 'contracts.contract.create');
      await expect(
        comoMcp(() =>
          tool.handle(
            {
              proposalId: (proposta.json() as { id: string }).id,
              startsOn: daquiA(1),
              endsOn: daquiA(90),
            } as never,
            { tenantId: empresa.tenantId, actorId: empresa.userId },
          ),
        ),
      ).rejects.toThrow(/proposta aceita/i);
    });
  });

  describe('auditoria', () => {
    it('registra o valor do contrato ao ativar', async () => {
      const token = await entrar(empresa);
      const proposalId = await propostaAceita(token);
      const criado = (
        await formalizar(token, proposalId)
      ).json() as ContratoJson;
      await requisicao({
        method: 'POST',
        url: `/api/v1/contracts/${criado.id}/activate`,
        token,
      });

      const trilha = await dono<{ metadata: Record<string, unknown> }[]>`
        select metadata from audit_events
        where tenant_id = ${empresa.tenantId}
          and action = 'contracts.contract.activated'
      `;
      expect(trilha).toHaveLength(1);
      expect(trilha[0]?.metadata).toMatchObject({
        valueCents: 450_000,
        currency: 'BRL',
      });
    });
  });
});
