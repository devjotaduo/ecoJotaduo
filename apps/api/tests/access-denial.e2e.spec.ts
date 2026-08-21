import { ACAO_DE_NEGACAO } from '@ecojotaduo/audit';
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

import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';
import { registrarContextoDeRequisicao } from '../src/http/request-context';

exigirBancoEmCI();

/** Credencial que não é um JWT — nomeada porque o literal casa com o
 *  detector de segredos do pré-commit. */
const CREDENCIAL_FORJADA = 'nao-e-jwt';

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

interface LinhaDaTrilha {
  readonly resource_id: string | null;
  readonly result: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly channel: string;
  readonly metadata: { required?: string; reason?: string; moduleId?: string };
}

/**
 * Fase 10: a recusa de acesso deixa rastro.
 *
 * Até aqui a plataforma registrava o que aconteceu e não o que foi barrado.
 * Quem estivesse sondando rotas proibidas não aparecia em lugar nenhum — e é
 * exatamente esse padrão que se quer conseguir enxergar ANTES de um incidente.
 *
 * O que NÃO é auditado, de propósito: recusa por token, vínculo ou empresa.
 * Nesses casos ainda não há empresa autenticada, e gravar a trilha exigiria
 * escolher um tenant a partir de um token que pode ser forjado — seria
 * inventar rastro, não registrá-lo.
 */
describe.skipIf(!temBancoDeTeste)('negação de acesso auditada (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;

  /** Papel `owner` (permissão `*`), mas sem o módulo CRM contratado. */
  let semModulo: TenantSemeado;
  /** Módulo contratado, mas papel `member` — nenhuma permissão de negócio. */
  let semPermissao: TenantSemeado;

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

  /** Lê a trilha pelo dono: o teste observa, não depende da rota de leitura. */
  async function negacoes(tenantId: string): Promise<LinhaDaTrilha[]> {
    return dono<LinhaDaTrilha[]>`
      select resource_id, result, tenant_id, actor_id, channel, metadata
      from audit_events
      where tenant_id = ${tenantId} and action = ${ACAO_DE_NEGACAO}
      order by occurred_at
    `;
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
    registrarContextoDeRequisicao(app.getHttpAdapter().getInstance());
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);

    semModulo = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: [],
    });
    semPermissao = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm'],
      papelId: PAPEL_MEMBER,
    });
  });

  it('módulo não contratado: 403 e trilha com a razão', async () => {
    const token = await entrar(semModulo);

    const resposta = await requisicao({
      method: 'GET',
      url: '/api/v1/crm/customers',
      token,
    });
    expect(resposta.statusCode).toBe(403);

    const trilha = await negacoes(semModulo.tenantId);
    expect(trilha).toHaveLength(1);
    expect(trilha[0]?.result).toBe('denied');
    expect(trilha[0]?.metadata.reason).toBe('entitlement');
    expect(trilha[0]?.metadata.moduleId).toBe('crm');
    expect(trilha[0]?.metadata.required).toBe('crm.customer.read');
    // Quem tentou, de onde e em quê — as três perguntas de uma investigação.
    expect(trilha[0]?.actor_id).toBe(semModulo.userId);
    expect(trilha[0]?.channel).toBe('rest');
    expect(trilha[0]?.resource_id).toContain('/api/v1/crm/customers');
  });

  it('módulo contratado mas papel sem a permissão: razão diferente', async () => {
    const token = await entrar(semPermissao);

    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/crm/customers',
      token,
      payload: { name: 'Construtora Alfa' },
    });
    expect(resposta.statusCode).toBe(403);

    const trilha = await negacoes(semPermissao.tenantId);
    expect(trilha).toHaveLength(1);
    // Distinguir "não contratou" de "não pode" é o que separa uma conversa
    // comercial de uma investigação de segurança.
    expect(trilha[0]?.metadata.reason).toBe('permission');
    expect(trilha[0]?.metadata.required).toBe('crm.customer.create');
  });

  it('sondagem repetida acumula rastro, uma linha por tentativa', async () => {
    const token = await entrar(semModulo);

    for (const url of [
      '/api/v1/crm/customers',
      '/api/v1/commercial/proposals',
      '/api/v1/assets',
    ]) {
      const resposta = await requisicao({ method: 'GET', url, token });
      expect(resposta.statusCode).toBe(403);
    }

    const trilha = await negacoes(semModulo.tenantId);
    expect(trilha).toHaveLength(3);
    expect(trilha.map((linha) => linha.metadata.moduleId)).toEqual([
      'crm',
      'commercial',
      'assets',
    ]);
  });

  it('a trilha de negação de uma empresa não vaza para a outra', async () => {
    const token = await entrar(semModulo);
    await requisicao({ method: 'GET', url: '/api/v1/crm/customers', token });

    expect(await negacoes(semModulo.tenantId)).toHaveLength(1);
    expect(await negacoes(semPermissao.tenantId)).toHaveLength(0);
  });

  it('token ausente ou inválido continua 401 e sem trilha', async () => {
    const semToken = await requisicao({
      method: 'GET',
      url: '/api/v1/crm/customers',
    });
    expect(semToken.statusCode).toBe(401);

    const forjado = await requisicao({
      method: 'GET',
      url: '/api/v1/crm/customers',
      token: CREDENCIAL_FORJADA,
    });
    expect(forjado.statusCode).toBe(401);

    // Nenhuma empresa recebe linha: não há contexto autenticado para atribuir.
    const [linha] = await dono<{ total: number }[]>`
      select count(*)::int as total from audit_events where action = ${ACAO_DE_NEGACAO}
    `;
    expect(linha?.total).toBe(0);
  });

  it('acesso permitido não gera linha de negação', async () => {
    const token = await entrar(semPermissao);

    // `platform.*` é do papel `member`? Não — mas a rota de sessão é pública
    // ao usuário autenticado, então passa sem tocar na cadeia de permissões.
    const resposta = await requisicao({
      method: 'GET',
      url: '/api/v1/auth/me',
      token,
    });
    expect(resposta.statusCode).toBe(200);
    expect(await negacoes(semPermissao.tenantId)).toHaveLength(0);
  });
});
