import { runMigrations } from '@ecojotaduo/database';
import { OutboxDispatcher } from '@ecojotaduo/events/dispatcher';
import type { EventHandler, IntegrationEvent } from '@ecojotaduo/events';
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

const MODULOS = ['crm', 'commercial', 'contracts', 'assets', 'operations'];

function daquiA(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
}

/** Handler de teste: registra o que recebeu e pode ser mandado falhar. */
class Consumidor implements EventHandler {
  readonly recebidos: IntegrationEvent[] = [];
  falhar = false;

  constructor(
    readonly name: string,
    readonly eventTypes: readonly string[],
  ) {}

  handle(evento: IntegrationEvent): Promise<void> {
    if (this.falhar) {
      return Promise.reject(new Error(`${this.name} indisponível`));
    }
    this.recebidos.push(evento);
    return Promise.resolve();
  }
}

/**
 * Fase 8: o fato de negócio sai da API e chega ao consumidor.
 *
 * O teste que importa é o segundo bloco: uma integração fora do ar não desfaz
 * a transação de negócio nem devolve erro pela API — que é o critério de
 * aceite da fase inteira.
 */
describe.skipIf(!temBancoDeTeste)('Eventos de integração (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let nucleo: NucleoDaPlataforma;
  let empresa: TenantSemeado;

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

  const eventosGravados = async (tipo?: string) => {
    const linhas = tipo
      ? await dono<{ type: string; status: string; payload: unknown }[]>`
          select type, status, payload from platform_outbox
          where tenant_id = ${empresa.tenantId} and type = ${tipo}
        `
      : await dono<{ type: string; status: string; payload: unknown }[]>`
          select type, status, payload from platform_outbox
          where tenant_id = ${empresa.tenantId} order by occurred_at
        `;
    return linhas;
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
    await dono`truncate table platform_outbox cascade`;
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
  });

  describe('o fato de negócio vira evento na mesma transação', () => {
    it('cadastrar cliente pela API grava o evento no outbox', async () => {
      const token = await entrar(empresa);
      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Alfa' },
      });
      expect(resposta.statusCode).toBe(201);

      const eventos = await eventosGravados('crm.customer.created.v1');
      expect(eventos).toHaveLength(1);
      expect(eventos[0]?.status).toBe('pending');
    });

    it('o evento NÃO é gravado quando a operação é recusada', async () => {
      const token = await entrar(empresa);
      await requisicao({
        method: 'POST',
        url: '/api/v1/assets',
        token,
        payload: { code: 'ESC-014', name: 'Escavadeira', category: 'escav' },
      });
      // Código repetido: recusado pelo caso de uso.
      const recusado = await requisicao({
        method: 'POST',
        url: '/api/v1/assets',
        token,
        payload: { code: 'ESC-014', name: 'Outra', category: 'escav' },
      });
      expect(recusado.statusCode).toBe(409);

      // Um evento só: o segundo cadastro não aconteceu, e não há fato dele.
      expect(await eventosGravados('assets.asset.registered.v1')).toHaveLength(
        1,
      );
    });

    it('a cadeia inteira deixa a trilha de fatos em ordem', async () => {
      const token = await entrar(empresa);
      const cliente = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Alfa' },
      });
      const customerId = (cliente.json() as { id: string }).id;

      const proposta = await requisicao({
        method: 'POST',
        url: '/api/v1/commercial/proposals',
        token,
        payload: {
          customerId,
          title: 'Locação',
          currency: 'BRL',
          validUntil: daquiA(7),
          items: [
            { description: 'Escavadeira', quantity: 1, unitPriceCents: 1000 },
          ],
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
        payload: { proposalId, startsOn: daquiA(-1), endsOn: daquiA(90) },
      });
      await requisicao({
        method: 'POST',
        url: `/api/v1/contracts/${(contrato.json() as { id: string }).id}/activate`,
        token,
      });

      const tipos = (await eventosGravados()).map((evento) => evento.type);
      expect(tipos).toEqual([
        'crm.customer.created.v1',
        'commercial.proposal.sent.v1',
        'commercial.proposal.approved.v1',
        'contracts.contract.activated.v1',
      ]);
    });
  });

  describe('integração fora do ar não derruba a API', () => {
    /** Monta a cadeia até uma locação em andamento. */
    async function locacaoEmAndamento(token: string): Promise<string> {
      const cliente = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Alfa' },
      });
      const proposta = await requisicao({
        method: 'POST',
        url: '/api/v1/commercial/proposals',
        token,
        payload: {
          customerId: (cliente.json() as { id: string }).id,
          title: 'Locação',
          currency: 'BRL',
          validUntil: daquiA(7),
          items: [
            {
              description: 'Escavadeira',
              quantity: 1,
              unitPriceCents: 450_000,
            },
          ],
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
        payload: { proposalId, startsOn: daquiA(-1), endsOn: daquiA(90) },
      });
      const contractId = (contrato.json() as { id: string }).id;
      await requisicao({
        method: 'POST',
        url: `/api/v1/contracts/${contractId}/activate`,
        token,
      });

      const ativo = await requisicao({
        method: 'POST',
        url: '/api/v1/assets',
        token,
        payload: { code: 'ESC-014', name: 'Escavadeira', category: 'escav' },
      });
      const locacao = await requisicao({
        method: 'POST',
        url: '/api/v1/operations/rentals',
        token,
        payload: {
          contractId,
          assetId: (ativo.json() as { id: string }).id,
          startsAt: daquiA(-1),
          endsAt: daquiA(10),
        },
      });
      const rentalId = (locacao.json() as { id: string }).id;
      await requisicao({
        method: 'POST',
        url: `/api/v1/operations/rentals/${rentalId}/start`,
        token,
      });
      return rentalId;
    }

    it('a devolução é gravada e responde 200 mesmo com o consumidor caído', async () => {
      const quebrado = new Consumidor('externo', ['operations.*']);
      quebrado.falhar = true;
      const dispatcher = new OutboxDispatcher(nucleo.outbox, [quebrado], {
        backoffBaseMs: 0,
      });

      const token = await entrar(empresa);
      const rentalId = await locacaoEmAndamento(token);

      const devolucao = await requisicao({
        method: 'POST',
        url: `/api/v1/operations/rentals/${rentalId}/finish`,
        token,
        payload: { reason: 'obra concluída' },
      });
      // A API não sabe nem espera pela integração: o consumidor é problema do
      // worker, e é isso que impede uma integração instável de virar 500.
      expect(devolucao.statusCode).toBe(200);

      const resumo = await dispatcher.processarCiclo();
      expect(resumo.falhados).toBeGreaterThan(0);

      // A devolução continua gravada, apesar da falha de entrega.
      const lida = await requisicao({
        method: 'GET',
        url: `/api/v1/operations/rentals/${rentalId}`,
        token,
      });
      expect((lida.json() as { status: string }).status).toBe('finished');
    });

    it('quando o consumidor volta, o evento é entregue sem repetir a operação', async () => {
      const consumidor = new Consumidor('externo', [
        'operations.rental.finished.v1',
      ]);
      consumidor.falhar = true;
      const dispatcher = new OutboxDispatcher(nucleo.outbox, [consumidor], {
        backoffBaseMs: 0,
      });

      const token = await entrar(empresa);
      const rentalId = await locacaoEmAndamento(token);
      await requisicao({
        method: 'POST',
        url: `/api/v1/operations/rentals/${rentalId}/finish`,
        token,
        payload: {},
      });

      await dispatcher.processarCiclo();
      expect(consumidor.recebidos).toHaveLength(0);

      consumidor.falhar = false;
      await dispatcher.processarCiclo();

      expect(consumidor.recebidos).toHaveLength(1);
      // O payload carrega o que a cobrança precisa, sem consultar de volta.
      expect(consumidor.recebidos[0]?.payload).toMatchObject({
        assetCode: 'ESC-014',
        overdueDays: 0,
      });
      // A devolução não aconteceu duas vezes.
      const linhas = await dono<{ total: number }[]>`
        select count(*)::int as total from platform_outbox
        where tenant_id = ${empresa.tenantId} and type = 'operations.rental.finished.v1'
      `;
      expect(linhas[0]?.total).toBe(1);
    });
  });

  describe('o worker monta o mesmo núcleo', () => {
    it('os handlers registrados na composição recebem os fatos', async () => {
      // O notificador do plugin está registrado; a empresa não habilitou o
      // plugin, então ele não faz nada — e mesmo assim o evento é entregue.
      const dispatcher = new OutboxDispatcher(
        nucleo.outbox,
        nucleo.handlersDeEventos,
      );

      const token = await entrar(empresa);
      await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Alfa' },
      });

      const resumo = await dispatcher.processarCiclo();
      expect(resumo.entregues).toBe(1);
      expect(
        (await eventosGravados('crm.customer.created.v1'))[0]?.status,
      ).toBe('delivered');
    });

    it('o payload não leva dado pessoal do cliente', async () => {
      // O evento fica guardado, atravessa processos e pode ir para fora. Só
      // identificação entra — documento, e-mail e telefone ficam no CRM.
      const token = await entrar(empresa);
      await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: {
          name: 'Construtora Alfa',
          email: 'contato@alfa.com.br',
          phone: '11999990000',
          document: '11222333000181',
        },
      });

      const [evento] = await eventosGravados('crm.customer.created.v1');
      const serializado = JSON.stringify(evento?.payload);
      expect(serializado).toContain('Construtora Alfa');
      expect(serializado).not.toContain('contato@alfa.com.br');
      expect(serializado).not.toContain('11999990000');
      expect(serializado).not.toContain('11222333000181');
    });
  });
});
