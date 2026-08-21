import { runMigrations } from '@ecojotaduo/database';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  PAPEL_MEMBER,
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

import {
  authenticateContext,
  createContext,
  runWithContext,
  toTenantId,
  toUserId,
} from '@ecojotaduo/tenant-context';

import { AppModule } from '../src/app.module';
import { PLATFORM_CORE } from '../src/bootstrap/tokens';
import type { NucleoDaPlataforma } from '@ecojotaduo/platform-core';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';
import { prepararBordaHttp } from '../src/http/borda';

exigirBancoEmCI();

interface RespostaHttp {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  json(): unknown;
}

function corpo<T>(resposta: RespostaHttp): T {
  return resposta.json() as T;
}

const CNPJ = '11.222.333/0001-81';
const CPF = '529.982.247-25';

function amanha(horas = 14): string {
  const data = new Date(Date.now() + 24 * 60 * 60 * 1000);
  data.setUTCHours(horas, 0, 0, 0);
  return data.toISOString();
}

/**
 * Fase 3 ponta a ponta: cadastro, nota e agendamento.
 *
 * O teste central é o último bloco: a MESMA operação executada por REST e pela
 * tool MCP precisa produzir o mesmo efeito e o mesmo formato — é o critério de
 * aceite da fase ("REST e MCP executam exatamente os mesmos casos de uso").
 */
describe.skipIf(!temBancoDeTeste)('CRM (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let nucleo: NucleoDaPlataforma;
  let empresa: TenantSemeado;
  let semCrm: TenantSemeado;
  let visitante: TenantSemeado;

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
    return corpo<{ accessToken: string }>(resposta).accessToken;
  }

  /**
   * Executa como o gateway MCP executará na Fase 5: contexto de request
   * aberto, tenant e ator resolvidos a partir do token — e nunca de
   * parâmetro da tool. Sem isso a chamada falha, e é assim que tem que ser.
   */
  /** Grant de administrador do tenant, como o gateway resolveria do token. */
  const GRANT_TOTAL = {
    permissions: ['*'],
    scopes: ['*'],
    entitlements: ['crm'],
  };

  function toolsMcp() {
    return nucleo.mcp.toolsDe(GRANT_TOTAL);
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
        entitlements: ['crm'],
      });
      return fn();
    });
  }

  async function criarCliente(token: string, nome = 'Construtora Alfa') {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/crm/customers',
      token,
      payload: { name: nome, document: CNPJ, email: 'contato@alfa.com.br' },
    });
    expect(resposta.statusCode).toBe(201);
    return corpo<{ id: string; name: string }>(resposta);
  }

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
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });
    // Mesma plataforma, sem o módulo CRM contratado.
    semCrm = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: [],
    });
    // Vínculo ativo, papel sem permissão nenhuma.
    visitante = await semearTenant(dono, {
      slug: 'empresa-c',
      email: 'carlos@empresa-c.com.br',
      papelId: PAPEL_MEMBER,
      modulos: ['crm'],
    });
  });

  describe('fluxo completo: cadastro → nota → agendamento → histórico', () => {
    it('percorre o ciclo e monta a linha do tempo', async () => {
      const token = await entrar(empresa);
      const cliente = await criarCliente(token);

      const nota = await requisicao({
        method: 'POST',
        url: `/api/v1/crm/customers/${cliente.id}/notes`,
        token,
        payload: { body: 'Cliente pediu orçamento de escavadeira' },
      });
      expect(nota.statusCode).toBe(201);

      const agendamento = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/appointments',
        token,
        payload: {
          customerId: cliente.id,
          title: 'Visita técnica',
          scheduledFor: amanha(14),
          durationMinutes: 60,
          assignedToId: empresa.userId,
        },
      });
      expect(agendamento.statusCode).toBe(201);
      const agendado = corpo<{ id: string; endsAt: string }>(agendamento);

      const detalhe = await requisicao({
        method: 'GET',
        url: `/api/v1/crm/customers/${cliente.id}`,
        token,
      });

      const visao = corpo<{
        documentFormatted: string;
        timeline: { kind: string; summary: string }[];
      }>(detalhe);

      expect(visao.documentFormatted).toBe(CNPJ);
      expect(visao.timeline).toHaveLength(2);
      expect(visao.timeline.map((item) => item.kind)).toEqual([
        'appointment',
        'note',
      ]);
      expect(agendado.endsAt).toBe(amanha(15));
    });

    it('conclui o agendamento e o desfecho aparece no histórico', async () => {
      const token = await entrar(empresa);
      const cliente = await criarCliente(token);

      const criado = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/appointments',
        token,
        payload: {
          customerId: cliente.id,
          title: 'Reunião de fechamento',
          scheduledFor: amanha(10),
          durationMinutes: 30,
        },
      });
      const { id } = corpo<{ id: string }>(criado);

      const concluido = await requisicao({
        method: 'POST',
        url: `/api/v1/crm/appointments/${id}/complete`,
        token,
        payload: { outcome: 'Proposta aprovada' },
      });

      expect(concluido.statusCode).toBe(200);
      expect(
        corpo<{ status: string; outcome: string }>(concluido),
      ).toMatchObject({
        status: 'done',
        outcome: 'Proposta aprovada',
      });
    });

    it('recusa conflito de agenda do mesmo responsável', async () => {
      const token = await entrar(empresa);
      const cliente = await criarCliente(token);
      const base = {
        customerId: cliente.id,
        title: 'Visita',
        durationMinutes: 60,
        assignedToId: empresa.userId,
      };

      await requisicao({
        method: 'POST',
        url: '/api/v1/crm/appointments',
        token,
        payload: { ...base, scheduledFor: amanha(9) },
      });

      const conflitante = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/appointments',
        token,
        payload: { ...base, scheduledFor: amanha(9) },
      });

      expect(conflitante.statusCode).toBe(409);
    });

    it('recusa documento duplicado na mesma empresa', async () => {
      const token = await entrar(empresa);
      await criarCliente(token);

      const repetido = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Outra Razão Social', document: CNPJ },
      });

      expect(repetido.statusCode).toBe(409);
    });

    it('recusa documento inválido antes de tocar o banco', async () => {
      const token = await entrar(empresa);

      const invalido = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Fantasma', document: '111.111.111-11' },
      });

      expect(invalido.statusCode).toBe(400);
    });
  });

  describe('autorização', () => {
    it('nega quando a empresa não contratou o módulo CRM', async () => {
      const token = await entrar(semCrm);

      const resposta = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token,
      });

      expect(resposta.statusCode).toBe(403);
      expect(corpo<{ type: string }>(resposta).type).toBe(
        'https://jotaduo.com/ecojotaduo/errors/module-not-entitled',
      );
    });

    it('nega quem tem o módulo mas não tem a permissão', async () => {
      const token = await entrar(visitante);

      const resposta = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token,
      });

      expect(resposta.statusCode).toBe(403);
      expect(corpo<{ type: string }>(resposta).type).toBe(
        'https://jotaduo.com/ecojotaduo/errors/forbidden',
      );
    });

    it('cliente de uma empresa é invisível para a outra', async () => {
      const tokenA = await entrar(empresa);
      const cliente = await criarCliente(tokenA);

      // A empresa C tem CRM contratado, mas o papel "member" não lê clientes;
      // então a prova de isolamento usa o próprio dono de outra empresa.
      const outra = await semearTenant(dono, {
        slug: 'empresa-d',
        email: 'dora@empresa-d.com.br',
        modulos: ['crm'],
      });
      const tokenD = await entrar(outra);

      const busca = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers?termo=Alfa',
        token: tokenD,
      });
      const detalhe = await requisicao({
        method: 'GET',
        url: `/api/v1/crm/customers/${cliente.id}`,
        token: tokenD,
      });

      expect(corpo<{ total: number }>(busca).total).toBe(0);
      expect(detalhe.statusCode).toBe(404);
    });
  });

  describe('critério de aceite: REST e MCP sobre o mesmo caso de uso', () => {
    it('a tool MCP e a rota REST produzem o mesmo resultado', async () => {
      const token = await entrar(empresa);

      // 1. Cadastro pela borda REST.
      const viaRest = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Cliente REST', document: CNPJ },
      });
      const clienteRest = corpo<Record<string, unknown>>(viaRest);

      // 2. Cadastro pela tool MCP, no mesmo tenant.
      const criarTool = toolsMcp().find(
        (tool) => tool.name === 'crm.customer.create',
      );
      expect(
        criarTool,
        'tool crm.customer.create precisa existir',
      ).toBeDefined();

      const clienteMcp = (await comoMcp(() =>
        criarTool!.handle({ name: 'Cliente MCP', document: CPF } as never, {
          tenantId: empresa.tenantId,
          actorId: empresa.userId,
        }),
      )) as Record<string, unknown>;

      // Mesma forma de resposta nas duas bordas (mesmos presenters).
      expect(Object.keys(clienteMcp).sort()).toEqual(
        Object.keys(clienteRest).sort(),
      );
      expect(clienteMcp.documentFormatted).toBe(CPF);

      // 3. A pesquisa REST enxerga o cliente criado pelo MCP: mesma persistência.
      const busca = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers?termo=Cliente',
        token,
      });
      const encontrados = corpo<{ items: { name: string }[] }>(busca).items.map(
        (item) => item.name,
      );

      expect(encontrados).toEqual(
        expect.arrayContaining(['Cliente REST', 'Cliente MCP']),
      );

      // 4. A auditoria registrou as duas, distinguindo a borda de origem —
      //    mesmo caso de uso, mesmo tenant, canais diferentes.
      const trilha = await requisicao({
        method: 'GET',
        url: '/api/v1/audit-events?action=crm.customer.created',
        token,
      });
      const canais = corpo<{ items: { channel: string }[] }>(trilha).items.map(
        (item) => item.channel,
      );

      expect(canais).toEqual(expect.arrayContaining(['rest', 'mcp']));
    });

    it('a tool MCP respeita as MESMAS regras de domínio da rota REST', async () => {
      const token = await entrar(empresa);
      const cliente = await criarCliente(token);

      const agendarTool = toolsMcp().find(
        (tool) => tool.name === 'crm.appointment.schedule',
      );

      // Ocupa o horário via REST...
      await requisicao({
        method: 'POST',
        url: '/api/v1/crm/appointments',
        token,
        payload: {
          customerId: cliente.id,
          title: 'Visita REST',
          scheduledFor: amanha(11),
          durationMinutes: 60,
          assignedToId: empresa.userId,
        },
      });

      // ...e o MCP recebe o mesmo "não" do domínio.
      await expect(
        comoMcp(() =>
          agendarTool!.handle(
            {
              customerId: cliente.id,
              title: 'Visita MCP',
              scheduledFor: amanha(11),
              durationMinutes: 60,
              assignedToId: empresa.userId,
            } as never,
            { tenantId: empresa.tenantId, actorId: empresa.userId },
          ),
        ),
      ).rejects.toThrow(/sobrep/i);
    });

    it('toda tool declara permissões e se é leitura ou escrita', () => {
      expect(toolsMcp().length).toBeGreaterThanOrEqual(7);

      for (const tool of toolsMcp()) {
        expect(tool.name, 'nome deve seguir dominio.entidade.acao').toMatch(
          /^crm\.[a-z-]+\.[a-z-]+$/,
        );
        expect(tool.requiredPermissions.length).toBeGreaterThan(0);
        expect(typeof tool.readOnly).toBe('boolean');
        expect(tool.description.length).toBeGreaterThan(20);
        // O tenant nunca é parâmetro de tool: vem do contexto autenticado.
        expect(JSON.stringify(tool.inputSchema)).not.toContain('tenantId');
      }
    });
  });

  describe('auditoria', () => {
    it('registra o cadastro do cliente na trilha da empresa', async () => {
      const token = await entrar(empresa);
      const cliente = await criarCliente(token);

      const auditoria = await requisicao({
        method: 'GET',
        url: '/api/v1/audit-events?action=crm.customer.created',
        token,
      });

      const trilha = corpo<{
        items: { resourceId: string; tenantId: string }[];
        total: number;
      }>(auditoria);

      expect(trilha.total).toBeGreaterThan(0);
      expect(trilha.items[0]?.resourceId).toBe(cliente.id);
      expect(trilha.items[0]?.tenantId).toBe(empresa.tenantId);
    });
  });
});
