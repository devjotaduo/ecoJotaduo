import { hashOpaqueToken } from '@ecojotaduo/auth';
import { runMigrations } from '@ecojotaduo/database';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  PAPEL_MEMBER,
  reservarBancoDeTestes,
  semearServiceAccount,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';
import { registrarContextoDeRequisicao } from '../src/http/request-context';

const SEGREDO_SERVICE_ACCOUNT = 'segredo-de-service-account-para-teste-0001';

// Valor propositalmente malformado. Fica numa constante (em vez de literal no
// lugar da chamada) porque o scanner de segredos do pré-commit do ECC casa
// `token: '...'` com 12+ caracteres — e este arquivo não tem segredo algum.
const CREDENCIAL_MALFORMADA = 'nao.e.um.token';

// Sem banco no CI, falha em vez de passar pulado.
exigirBancoEmCI();

interface RespostaHttp {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  json(): unknown;
}

/** Lê o corpo JSON com o formato esperado pelo teste. */
function corpo<T>(resposta: RespostaHttp): T {
  return resposta.json() as T;
}

interface Sessao {
  accessToken: string;
  refreshToken: string;
  tenant: { id: string; slug: string; name: string };
  permissions: string[];
  entitlements: string[];
}

interface Problema {
  type: string;
  status: number;
  detail: string;
  correlationId?: string;
}

/**
 * Critério de aceite da Fase 2: um usuário do Tenant A não acessa NADA do
 * Tenant B — dados, auditoria, contratação de módulos ou rotas.
 *
 * Roda contra PostgreSQL real, conectando com o papel restrito (a RLS não se
 * aplica ao dono das tabelas). Sem banco configurado, a suíte é PULADA.
 */
describe.skipIf(!temBancoDeTeste)('Isolamento entre tenants (E2E)', () => {
  let dono: postgres.Sql;
  let liberarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;
  let visitante: TenantSemeado;

  async function requisicao(opcoes: {
    method: 'GET' | 'POST' | 'DELETE';
    url: string;
    token?: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }): Promise<RespostaHttp> {
    return app.inject({
      method: opcoes.method,
      url: opcoes.url,
      payload: opcoes.payload as never,
      headers: {
        ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}),
        ...opcoes.headers,
      },
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
    return corpo<Sessao>(resposta).accessToken;
  }

  async function modulosDe(token: string): Promise<string[]> {
    const resposta = await requisicao({
      method: 'GET',
      url: '/api/v1/modules',
      token,
    });
    expect(resposta.statusCode).toBe(200);
    return corpo<{ items: { moduleId: string }[] }>(resposta).items.map(
      (item) => item.moduleId,
    );
  }

  beforeAll(async () => {
    // Serializa com as demais suítes de integração (banco compartilhado).
    liberarBanco = await reservarBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    await limparDados(dono);

    empresaA = await semearTenant(dono, {
      slug: 'empresa-a',
      nome: 'Empresa A',
      email: 'ana@empresa-a.com.br',
      modulos: ['identity'],
    });
    // Sem nenhum módulo contratado: serve de contraprova nos testes.
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      nome: 'Empresa B',
      email: 'bruno@empresa-b.com.br',
      modulos: [],
    });
    // Vínculo ativo, porém com papel "member" — nenhuma permissão.
    visitante = await semearTenant(dono, {
      slug: 'empresa-c',
      nome: 'Empresa C',
      email: 'carlos@empresa-c.com.br',
      papelId: PAPEL_MEMBER,
      modulos: ['identity'],
    });

    await semearServiceAccount(dono, {
      tenantId: empresaB.tenantId,
      clientId: 'integracao-empresa-b',
      secretHash: hashOpaqueToken(SEGREDO_SERVICE_ACCOUNT),
      scopes: ['platform.tenant.read'],
    });

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
  });

  afterAll(async () => {
    await app?.close();
    await dono.end({ timeout: 5 });
    await liberarBanco?.();
  });

  // -------------------------------------------------------------------------
  describe('autenticação', () => {
    it('emite sessão com tenant, permissões e módulos contratados', async () => {
      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: empresaA.email,
          password: empresaA.senha,
          tenantSlug: empresaA.slug,
        },
      });

      expect(resposta.statusCode).toBe(200);
      const sessao = corpo<Sessao>(resposta);
      expect(sessao.tenant.id).toBe(empresaA.tenantId);
      expect(sessao.permissions).toContain('*');
      expect(sessao.entitlements).toContain('identity');
      expect(sessao.refreshToken).toBeTypeOf('string');
    });

    it('senha errada e empresa inexistente devolvem o MESMO 401', async () => {
      const senhaErrada = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: empresaA.email,
          password: 'errada',
          tenantSlug: empresaA.slug,
        },
      });
      const empresaInventada = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: empresaA.email,
          password: empresaA.senha,
          tenantSlug: 'nao-existe',
        },
      });

      expect(senhaErrada.statusCode).toBe(401);
      expect(empresaInventada.statusCode).toBe(401);
      // Mesma mensagem: não revela se o e-mail ou a empresa existem.
      expect(corpo<Problema>(senhaErrada).detail).toBe(
        corpo<Problema>(empresaInventada).detail,
      );
      expect(senhaErrada.headers['content-type']).toContain(
        'application/problem+json',
      );
    });

    it('usuário da empresa A não consegue entrar na empresa B', async () => {
      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: empresaA.email,
          password: empresaA.senha,
          tenantSlug: empresaB.slug,
        },
      });

      expect(resposta.statusCode).toBe(401);
    });

    it('recusa requisição sem token e com token malformado', async () => {
      const semToken = await requisicao({
        method: 'GET',
        url: '/api/v1/auth/me',
      });
      const tokenInvalido = await requisicao({
        method: 'GET',
        url: '/api/v1/auth/me',
        token: CREDENCIAL_MALFORMADA,
      });

      expect(semToken.statusCode).toBe(401);
      expect(tokenInvalido.statusCode).toBe(401);
    });

    it('rotaciona o refresh token e invalida o anterior', async () => {
      const login = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: empresaB.email,
          password: empresaB.senha,
          tenantSlug: empresaB.slug,
        },
      });
      const { refreshToken } = corpo<Sessao>(login);

      const primeira = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken },
      });
      expect(primeira.statusCode).toBe(200);

      // Reuso do token já rotacionado: recusado (e derruba a família).
      const reuso = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken },
      });
      expect(reuso.statusCode).toBe(401);
    });

    it('autentica aplicação por client credentials, presa ao tenant da conta', async () => {
      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/token',
        payload: {
          clientId: 'integracao-empresa-b',
          clientSecret: SEGREDO_SERVICE_ACCOUNT,
        },
      });

      expect(resposta.statusCode).toBe(200);
      const { accessToken } = corpo<{ accessToken: string }>(resposta);

      const me = await requisicao({
        method: 'GET',
        url: '/api/v1/auth/me',
        token: accessToken,
      });
      expect(me.statusCode).toBe(200);
      expect(
        corpo<{ tenantId: string; actor: { kind: string } }>(me),
      ).toMatchObject({
        tenantId: empresaB.tenantId,
        actor: { kind: 'service' },
      });
    });

    it('rejeita segredo errado de service account', async () => {
      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/token',
        payload: {
          clientId: 'integracao-empresa-b',
          clientSecret: 'segredo-errado',
        },
      });

      expect(resposta.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('isolamento entre empresas', () => {
    it('o token carrega o tenant: não existe parâmetro para trocar de empresa', async () => {
      const token = await entrar(empresaA);

      const me = await requisicao({
        method: 'GET',
        url: '/api/v1/auth/me',
        token,
      });

      expect(corpo<{ tenantId: string }>(me).tenantId).toBe(empresaA.tenantId);
    });

    it('contratar módulo com o token da A não afeta a B', async () => {
      const tokenA = await entrar(empresaA);
      const tokenB = await entrar(empresaB);

      const criado = await requisicao({
        method: 'POST',
        url: '/api/v1/modules',
        token: tokenA,
        payload: { moduleId: 'crm' },
      });
      expect([201, 409]).toContain(criado.statusCode);

      expect(await modulosDe(tokenA)).toContain('crm');
      expect(await modulosDe(tokenB)).not.toContain('crm');
    });

    it('a auditoria de uma empresa não aparece para a outra', async () => {
      const tokenA = await entrar(empresaA);
      const tokenB = await entrar(empresaB);

      // Ação auditável exclusiva da empresa A.
      await requisicao({
        method: 'GET',
        url: '/api/v1/auth/my-tenants',
        token: tokenA,
      });

      const auditoriaDaA = await requisicao({
        method: 'GET',
        url: '/api/v1/audit-events?action=tenancy.tenants.listed',
        token: tokenA,
      });
      const auditoriaDaB = await requisicao({
        method: 'GET',
        url: '/api/v1/audit-events?action=tenancy.tenants.listed',
        token: tokenB,
      });

      const daA = corpo<{ items: { tenantId: string }[]; total: number }>(
        auditoriaDaA,
      );
      const daB = corpo<{ total: number }>(auditoriaDaB);

      expect(daA.total).toBeGreaterThan(0);
      expect(
        daA.items.every((item) => item.tenantId === empresaA.tenantId),
      ).toBe(true);
      expect(daB.total).toBe(0);
    });

    it('listar minhas empresas mostra apenas os próprios vínculos', async () => {
      const token = await entrar(empresaA);

      const resposta = await requisicao({
        method: 'GET',
        url: '/api/v1/auth/my-tenants',
        token,
      });

      const { items } = corpo<{ items: { slug: string }[] }>(resposta);
      expect(items.map((item) => item.slug)).toEqual(['empresa-a']);
    });
  });

  // -------------------------------------------------------------------------
  describe('autorização', () => {
    it('nega quem tem vínculo mas nenhuma permissão (403)', async () => {
      const token = await entrar(visitante);

      const resposta = await requisicao({
        method: 'GET',
        url: '/api/v1/modules',
        token,
      });

      expect(resposta.statusCode).toBe(403);
      expect(corpo<Problema>(resposta).type).toBe(
        'https://jotaduo.com/ecojotaduo/errors/forbidden',
      );
    });

    it('contratação do módulo governa a rota, mesmo com permissão total', async () => {
      const token = await entrar(empresaB);

      // 1. Sem o módulo contratado: 403 dizendo exatamente o motivo.
      const semContrato = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token,
      });
      expect(semContrato.statusCode).toBe(403);
      expect(corpo<Problema>(semContrato).type).toBe(
        'https://jotaduo.com/ecojotaduo/errors/module-not-entitled',
      );

      // 2. Contratado o módulo, o MESMO token passa a valer — o acesso é
      //    resolvido do banco a cada requisição, sem novo login.
      const contratado = await requisicao({
        method: 'POST',
        url: '/api/v1/modules',
        token,
        payload: { moduleId: 'crm' },
      });
      expect(contratado.statusCode).toBe(201);

      const comContrato = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token,
      });
      expect(comContrato.statusCode).toBe(200);

      // 3. Cancelado, o acesso some na requisição seguinte.
      const cancelado = await requisicao({
        method: 'DELETE',
        url: '/api/v1/modules/crm',
        token,
      });
      expect(cancelado.statusCode).toBe(204);

      const aposCancelar = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token,
      });
      expect(aposCancelar.statusCode).toBe(403);
    });

    it('escopo do token limita a service account além do RBAC', async () => {
      const emissao = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/token',
        payload: {
          clientId: 'integracao-empresa-b',
          clientSecret: SEGREDO_SERVICE_ACCOUNT,
        },
      });
      const { accessToken } = corpo<{ accessToken: string }>(emissao);

      const permitido = await requisicao({
        method: 'GET',
        url: '/api/v1/modules',
        token: accessToken,
      });
      const negado = await requisicao({
        method: 'POST',
        url: '/api/v1/modules',
        token: accessToken,
        payload: { moduleId: 'identity' },
      });

      expect(permitido.statusCode).toBe(200);
      expect(negado.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('observabilidade e entrada', () => {
    it('devolve o correlation id em toda resposta', async () => {
      const informado = 'correlacao-de-teste-123';
      const resposta = await requisicao({
        method: 'GET',
        url: '/health',
        headers: { 'x-correlation-id': informado },
      });

      expect(resposta.headers['x-correlation-id']).toBe(informado);
    });

    it('erros trazem o correlation id no corpo (Problem Details)', async () => {
      const resposta = await requisicao({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      const problema = corpo<Problema>(resposta);
      expect(problema.status).toBe(401);
      expect(problema.correlationId).toBeTypeOf('string');
    });

    it('valida a entrada antes de chegar ao caso de uso', async () => {
      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'a@b.com.br',
          password: 'x',
          tenantSlug: 'SLUG INVÁLIDO!',
        },
      });

      expect(resposta.statusCode).toBe(400);
      expect(corpo<Problema>(resposta).status).toBe(400);
    });

    it('readiness confirma o banco', async () => {
      const resposta = await requisicao({
        method: 'GET',
        url: '/health/ready',
      });

      expect(resposta.statusCode).toBe(200);
      expect(
        corpo<{ checks: { database: string } }>(resposta).checks.database,
      ).toBe('ok');
    });
  });
});
