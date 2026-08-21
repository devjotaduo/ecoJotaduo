import { criarClienteDaApi, ouFalhar, ApiError } from '@ecojotaduo/api-client';
import { runMigrations } from '@ecojotaduo/database';
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

const CNPJ = '11.222.333/0001-81';

function amanha(horas = 14): string {
  const data = new Date(Date.now() + 24 * 60 * 60 * 1000);
  data.setUTCHours(horas, 0, 0, 0);
  return data.toISOString();
}

/**
 * Critério de aceite da Fase 4: um consumidor usa APENAS o SDK gerado.
 *
 * Nenhum tipo escrito à mão, nenhum `fetch` solto, nenhuma URL montada na
 * unha — tudo vem de `@ecojotaduo/api-client`, cujos tipos saem do
 * `openapi.json` que o próprio código gerou. Se o contrato mudar sem o SDK
 * ser regenerado, isto para de compilar.
 */
describe.skipIf(!temBancoDeTeste)('SDK gerado contra a API real', () => {
  let dono: postgres.Sql;
  let liberarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let baseUrl: string;
  let empresa: TenantSemeado;

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

    // Servidor de verdade em porta efêmera: o SDK fala HTTP, não injeção.
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await dono.end({ timeout: 5 });
    await liberarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);
    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });
  });

  function cliente() {
    return criarClienteDaApi({ baseUrl });
  }

  it('faz o ciclo completo do CRM só com o SDK', async () => {
    const api = cliente();
    await api.entrar({
      email: empresa.email,
      password: empresa.senha,
      tenantSlug: empresa.slug,
    });

    const criado = await ouFalhar(
      api.rotas.POST('/api/v1/crm/customers', {
        body: { name: 'Construtora Alfa', document: CNPJ },
      }),
    );
    expect(criado.documentFormatted).toBe(CNPJ);

    await ouFalhar(
      api.rotas.POST('/api/v1/crm/customers/{customerId}/notes', {
        params: { path: { customerId: criado.id } },
        body: { body: 'Cliente pediu orçamento de escavadeira' },
      }),
    );

    const agendamento = await ouFalhar(
      api.rotas.POST('/api/v1/crm/appointments', {
        body: {
          customerId: criado.id,
          title: 'Visita técnica',
          scheduledFor: amanha(14),
          durationMinutes: 60,
          assignedToId: empresa.userId,
        },
      }),
    );
    expect(agendamento.endsAt).toBe(amanha(15));

    const detalhe = await ouFalhar(
      api.rotas.GET('/api/v1/crm/customers/{customerId}', {
        params: { path: { customerId: criado.id } },
      }),
    );

    // O tipo de `timeline` veio do OpenAPI — nada foi declarado à mão aqui.
    expect(detalhe.timeline).toHaveLength(2);
    expect(detalhe.timeline.map((item) => item.kind)).toEqual([
      'appointment',
      'note',
    ]);
  });

  it('renova a sessão sozinho quando o access token expira', async () => {
    const api = cliente();
    const sessao = await api.entrar({
      email: empresa.email,
      password: empresa.senha,
      tenantSlug: empresa.slug,
    });

    // Simula token expirado mantendo o refresh válido: o SDK deve renovar e
    // repetir a chamada sem que o consumidor perceba.
    const armazenamento = api.sessaoAtual();
    expect(armazenamento).not.toBeNull();
    api.sair();
    const apiComTokenRuim = criarClienteDaApi({
      baseUrl,
      armazenamento: {
        ler: () => ({
          accessToken: 'token.invalido.aqui',
          refreshToken: sessao.refreshToken,
        }),
        gravar: () => undefined,
      },
    });

    const pagina = await ouFalhar(
      apiComTokenRuim.rotas.GET('/api/v1/crm/customers', {
        params: { query: { limit: 10, offset: 0 } },
      }),
    );

    expect(pagina.total).toBe(0);
  });

  it('erro do servidor chega tipado, com correlationId', async () => {
    const api = cliente();
    await api.entrar({
      email: empresa.email,
      password: empresa.senha,
      tenantSlug: empresa.slug,
    });
    await ouFalhar(
      api.rotas.POST('/api/v1/crm/customers', {
        body: { name: 'Primeira', document: CNPJ },
      }),
    );

    const erro = (await ouFalhar(
      api.rotas.POST('/api/v1/crm/customers', {
        body: { name: 'Duplicada', document: CNPJ },
      }),
    ).catch((causa: unknown) => causa)) as ApiError;

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.status).toBe(409);
    expect(erro.correlationId).toBeTruthy();
    expect(erro.message).toContain('11.222.333/0001-81');
  });

  it('módulo não contratado chega classificado para a interface reagir', async () => {
    const semCrm = await semearTenant(dono, {
      slug: 'empresa-sem-crm',
      email: 'bruno@sem-crm.com.br',
      modulos: [],
    });

    const api = cliente();
    await api.entrar({
      email: semCrm.email,
      password: semCrm.senha,
      tenantSlug: semCrm.slug,
    });

    const erro = (await ouFalhar(
      api.rotas.GET('/api/v1/crm/customers', {
        params: { query: { limit: 10, offset: 0 } },
      }),
    ).catch((causa: unknown) => causa)) as ApiError;

    expect(erro.moduloNaoContratado).toBe(true);
    expect(erro.semPermissao).toBe(false);
  });
});
