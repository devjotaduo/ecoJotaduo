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
import { registrarContextoDeRequisicao } from '../src/http/request-context';

exigirBancoEmCI();

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

interface LocacaoJson {
  id: string;
  number: number;
  contractId: string;
  customerId: string;
  assetId: string;
  assetCode: string;
  holdId: string;
  status: string;
  storedStatus: string;
  overdueDays: number;
}

interface AtivoJson {
  id: string;
  availability: string;
  currentHold: { id: string; reason: string } | null;
}

const MODULOS = ['crm', 'commercial', 'contracts', 'assets', 'operations'];

function daquiA(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fase 7, quarto vertical: a cadeia inteira, CRM → Comercial → Contratos →
 * Ativos → Operações.
 *
 * O teste que importa é o segundo bloco: programar a locação BLOQUEIA o
 * equipamento no patrimônio, e é esse bloqueio — não um acordo entre módulos —
 * que impede a segunda locação no mesmo período.
 */
describe.skipIf(!temBancoDeTeste)('Operações (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let nucleo: NucleoDaPlataforma;
  let empresa: TenantSemeado;
  let semOperacoes: TenantSemeado;

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

  /** Percorre CRM → Comercial → Contratos até um contrato EM VIGOR. */
  async function contratoAtivo(token: string): Promise<string> {
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
        title: 'Locação de escavadeira',
        currency: 'BRL',
        validUntil: daquiA(7),
        items: [
          {
            description: 'Escavadeira 20t',
            quantity: 1,
            unitPriceCents: 450_000,
          },
        ],
      },
    });
    const { id: proposalId } = proposta.json() as { id: string };

    await requisicao({
      method: 'POST',
      url: `/api/v1/commercial/proposals/${proposalId}/send`,
      token,
    });
    await requisicao({
      method: 'POST',
      url: `/api/v1/commercial/proposals/${proposalId}/accept`,
      token,
    });

    const contrato = await requisicao({
      method: 'POST',
      url: '/api/v1/contracts',
      token,
      payload: { proposalId, startsOn: daquiA(-1), endsOn: daquiA(90) },
    });
    const { id: contractId } = contrato.json() as { id: string };

    const ativo = await requisicao({
      method: 'POST',
      url: `/api/v1/contracts/${contractId}/activate`,
      token,
    });
    expect(ativo.statusCode).toBe(200);
    return contractId;
  }

  async function equipamento(token: string, code = 'ESC-014'): Promise<string> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/assets',
      token,
      payload: { code, name: 'Escavadeira 20t', category: 'escavadeira' },
    });
    expect(resposta.statusCode).toBe(201);
    return (resposta.json() as { id: string }).id;
  }

  function programar(
    token: string,
    contractId: string,
    assetId: string,
    janela = { startsAt: daquiA(1), endsAt: daquiA(10) },
  ): Promise<RespostaHttp> {
    return requisicao({
      method: 'POST',
      url: '/api/v1/operations/rentals',
      token,
      payload: { contractId, assetId, ...janela },
    });
  }

  async function lerAtivo(token: string, assetId: string): Promise<AtivoJson> {
    const resposta = await requisicao({
      method: 'GET',
      url: `/api/v1/assets/${assetId}`,
      token,
    });
    return resposta.json() as AtivoJson;
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
    registrarContextoDeRequisicao(app.getHttpAdapter().getInstance());
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
    await dono`truncate table operations_rentals, operations_rental_numbers cascade`;
    await dono`truncate table assets_asset_holds, assets_assets cascade`;
    await dono`truncate table contracts_contracts, contracts_contract_numbers cascade`;
    await dono`truncate table commercial_proposal_items, commercial_proposals, commercial_proposal_numbers cascade`;
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: MODULOS,
    });
    // Tem tudo, menos Operações.
    semOperacoes = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm', 'commercial', 'contracts', 'assets'],
    });
  });

  describe('a cadeia CRM → Comercial → Contratos → Ativos → Operações', () => {
    it('programa a locação com o cliente do contrato e o código do equipamento', async () => {
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);

      const resposta = await programar(token, contractId, assetId);
      expect(resposta.statusCode).toBe(201);

      const locacao = resposta.json() as LocacaoJson;
      // Cliente e código NÃO foram informados: vieram do contrato e do ativo.
      expect(locacao.customerId).toBeTruthy();
      expect(locacao.assetCode).toBe('ESC-014');
      expect(locacao.number).toBe(1);
      expect(locacao.status).toBe('scheduled');
      expect(locacao.overdueDays).toBe(0);
    });

    it('recusa locação sob contrato ainda em rascunho', async () => {
      const token = await entrar(empresa);
      const assetId = await equipamento(token);

      // Um contrato formalizado, mas não ativado.
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
          title: 'Outra locação',
          currency: 'BRL',
          validUntil: daquiA(7),
          items: [{ description: 'Item', quantity: 1, unitPriceCents: 1000 }],
        },
      });
      const proposalId = (proposta.json() as { id: string }).id;
      await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposalId}/send`,
        token,
      });
      await requisicao({
        method: 'POST',
        url: `/api/v1/commercial/proposals/${proposalId}/accept`,
        token,
      });
      const contrato = await requisicao({
        method: 'POST',
        url: '/api/v1/contracts',
        token,
        payload: { proposalId, startsOn: daquiA(1), endsOn: daquiA(90) },
      });

      const recusa = await programar(
        token,
        (contrato.json() as { id: string }).id,
        assetId,
      );
      expect(recusa.statusCode).toBe(409);
    });

    it('recusa locação que passa do fim da vigência do contrato', async () => {
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);

      const recusa = await programar(token, contractId, assetId, {
        startsAt: daquiA(1),
        endsAt: daquiA(200),
      });
      expect(recusa.statusCode).toBe(409);
    });
  });

  describe('a locação reserva o equipamento no patrimônio', () => {
    it('programar deixa o equipamento bloqueado, com o motivo certo', async () => {
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);

      const antes = await lerAtivo(token, assetId);
      expect(antes.availability).toBe('available');

      const locacao = (
        await programar(token, contractId, assetId, {
          startsAt: daquiA(-1),
          endsAt: daquiA(10),
        })
      ).json() as LocacaoJson;

      const depois = await lerAtivo(token, assetId);
      // Nenhum código de Operações escreveu em `assets_*`: quem bloqueou foi
      // o caso de uso de Ativos, chamado pela superfície pública.
      expect(depois.availability).toBe('held');
      expect(depois.currentHold?.id).toBe(locacao.holdId);
      expect(depois.currentHold?.reason).toBe('reserved');
    });

    it('a SEGUNDA locação no mesmo período é recusada pelo patrimônio', async () => {
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);
      const janela = { startsAt: daquiA(1), endsAt: daquiA(10) };

      expect(
        (await programar(token, contractId, assetId, janela)).statusCode,
      ).toBe(201);
      // A garantia não é um acordo entre módulos: é a restrição de exclusão
      // sobre os bloqueios, que já existia antes de Operações nascer.
      const segunda = await programar(token, contractId, assetId, {
        startsAt: daquiA(5),
        endsAt: daquiA(15),
      });
      expect(segunda.statusCode).toBe(409);
    });

    it('devolver adiantado devolve o equipamento ao pátio na hora', async () => {
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);

      const locacao = (
        await programar(token, contractId, assetId, {
          startsAt: daquiA(-1),
          endsAt: daquiA(30),
        })
      ).json() as LocacaoJson;

      await requisicao({
        method: 'POST',
        url: `/api/v1/operations/rentals/${locacao.id}/start`,
        token,
      });
      const devolvida = await requisicao({
        method: 'POST',
        url: `/api/v1/operations/rentals/${locacao.id}/finish`,
        token,
        payload: { reason: 'obra terminou antes' },
      });
      expect(devolvida.statusCode).toBe(200);

      const depois = await lerAtivo(token, assetId);
      // O prazo previsto ia até daqui a 30 dias; sem a liberação, o
      // equipamento ficaria parado no pátio até lá.
      expect(depois.availability).toBe('available');

      // E o período liberado aceita nova locação.
      expect(
        (
          await programar(token, contractId, assetId, {
            startsAt: daquiA(2),
            endsAt: daquiA(20),
          })
        ).statusCode,
      ).toBe(201);
    });

    it('cancelar antes da retirada também libera', async () => {
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);

      const locacao = (
        await programar(token, contractId, assetId, {
          startsAt: daquiA(-1),
          endsAt: daquiA(10),
        })
      ).json() as LocacaoJson;

      const cancelada = await requisicao({
        method: 'POST',
        url: `/api/v1/operations/rentals/${locacao.id}/cancel`,
        token,
        payload: { reason: 'cliente desistiu' },
      });
      expect(cancelada.statusCode).toBe(200);
      expect((await lerAtivo(token, assetId)).availability).toBe('available');
    });

    it('não cancela depois que o equipamento saiu', async () => {
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);
      const locacao = (
        await programar(token, contractId, assetId)
      ).json() as LocacaoJson;

      await requisicao({
        method: 'POST',
        url: `/api/v1/operations/rentals/${locacao.id}/start`,
        token,
      });
      const recusa = await requisicao({
        method: 'POST',
        url: `/api/v1/operations/rentals/${locacao.id}/cancel`,
        token,
        payload: {},
      });
      expect(recusa.statusCode).toBe(409);
    });

    it('equipamento com locação em vigor não pode receber baixa', async () => {
      // Duas regras de módulos diferentes se encontram: Ativos recusa a baixa
      // porque há bloqueio vigente, e o bloqueio existe porque há locação.
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);
      await programar(token, contractId, assetId, {
        startsAt: daquiA(-1),
        endsAt: daquiA(10),
      });

      const baixa = await requisicao({
        method: 'POST',
        url: `/api/v1/assets/${assetId}/retire`,
        token,
        payload: {},
      });
      expect(baixa.statusCode).toBe(409);
    });
  });

  describe('módulo contratado', () => {
    it('empresa sem Operações não acessa a rota nem enxerga as tools', async () => {
      const token = await entrar(semOperacoes);
      const rota = await requisicao({
        method: 'GET',
        url: '/api/v1/operations/rentals',
        token,
      });
      expect(rota.statusCode).toBe(403);

      const grant = await nucleo.tenancy.resolveUserAccess({
        tenantId: semOperacoes.tenantId,
        userId: semOperacoes.userId,
        scopes: ['*'],
      });
      const nomes = nucleo.mcp.toolsDe(grant).map((tool) => tool.name);

      expect(nomes.some((nome) => nome.startsWith('operations.'))).toBe(false);
      // Mas Ativos, que ela contratou, continua lá.
      expect(nomes).toContain('assets.asset.availability');
    });
  });

  describe('REST e MCP executam o mesmo caso de uso', () => {
    it('a tool programa a locação e o REST enxerga o mesmo estado', async () => {
      const token = await entrar(empresa);
      const contractId = await contratoAtivo(token);
      const assetId = await equipamento(token);

      const tool = nucleo.mcp.acharTool(GRANT, 'operations.rental.schedule');
      const locacao = (await comoMcp(() =>
        tool.handle(
          {
            contractId,
            assetId,
            startsAt: daquiA(-1),
            endsAt: daquiA(10),
          } as never,
          { tenantId: empresa.tenantId, actorId: empresa.userId },
        ),
      )) as LocacaoJson;

      const pelaRota = await requisicao({
        method: 'GET',
        url: `/api/v1/operations/rentals/${locacao.id}`,
        token,
      });
      expect((pelaRota.json() as LocacaoJson).number).toBe(locacao.number);
      // E o efeito colateral no patrimônio é o mesmo.
      expect((await lerAtivo(token, assetId)).availability).toBe('held');
    });

    it('a tool respeita a MESMA recusa de contrato fora de vigor', async () => {
      const token = await entrar(empresa);
      const assetId = await equipamento(token);
      const contractId = await contratoAtivo(token);
      await requisicao({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/finish`,
        token,
        payload: { reason: 'encerrado' },
      });

      const tool = nucleo.mcp.acharTool(GRANT, 'operations.rental.schedule');
      await expect(
        comoMcp(() =>
          tool.handle(
            {
              contractId,
              assetId,
              startsAt: daquiA(1),
              endsAt: daquiA(10),
            } as never,
            { tenantId: empresa.tenantId, actorId: empresa.userId },
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe('isolamento entre empresas', () => {
    it('a locação de uma empresa não existe para a outra', async () => {
      const tokenA = await entrar(empresa);
      const contractId = await contratoAtivo(tokenA);
      const assetId = await equipamento(tokenA);
      const locacao = (
        await programar(tokenA, contractId, assetId)
      ).json() as LocacaoJson;

      const tokenB = await entrar(semOperacoes);
      const busca = await requisicao({
        method: 'GET',
        url: `/api/v1/operations/rentals/${locacao.id}`,
        token: tokenB,
      });
      // 403 antes de 404: a empresa nem contratou o módulo.
      expect(busca.statusCode).toBe(403);
    });
  });
});
