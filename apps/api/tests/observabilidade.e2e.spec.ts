import { runMigrations } from '@ecojotaduo/database';
import { CABECALHOS_DE_SEGURANCA } from '@ecojotaduo/platform-kernel';
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
  readonly headers: Record<string, unknown>;
  json(): unknown;
}

interface LinhaDeLog {
  tipo?: string;
  nivel?: string;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  correlationId?: string;
  tenantId?: string;
  actorKind?: string;
  actorId?: string;
  channel?: string;
}

/**
 * Fase 10, critério de aceite: para QUALQUER requisição é possível responder
 * quem fez, de qual empresa, por qual interface, o quê, quanto tempo levou e
 * qual foi o resultado.
 *
 * A trilha de auditoria já responde isso para ações de negócio. Este teste
 * cobre o resto — leitura, erro, recusa, health check —, que é onde "a API
 * está lenta" precisa virar "esta rota, desta empresa, está lenta".
 */
describe.skipIf(!temBancoDeTeste)('observabilidade da borda (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let empresa: TenantSemeado;
  const registradas: LinhaDeLog[] = [];

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

  /** A última linha de requisição registrada para uma rota. */
  function ultimaDe(rota: string): LinhaDeLog | undefined {
    return [...registradas]
      .reverse()
      .find((linha) => linha.tipo === 'requisicao' && linha.route === rota);
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
      new FastifyAdapter({
        // Captura o que o logger recebe: o teste observa a saída de verdade,
        // e não uma função de formatação chamada isoladamente.
        logger: {
          level: 'info',
          stream: {
            write: (bruto: string) => {
              const linha = JSON.parse(bruto) as { msg?: string };
              if (typeof linha.msg === 'string' && linha.msg.startsWith('{')) {
                registradas.push(JSON.parse(linha.msg) as LinhaDeLog);
              }
            },
          },
        },
      }),
    );
    await prepararBordaHttp(app);
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
    registradas.length = 0;
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);
    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });
  });

  describe('cabeçalhos de segurança', () => {
    it('toda resposta traz o conjunto, inclusive as de erro', async () => {
      const autenticada = await requisicao({ method: 'GET', url: '/health' });
      const recusada = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
      });
      expect(recusada.statusCode).toBe(401);

      for (const resposta of [autenticada, recusada]) {
        for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
          expect(resposta.headers[nome]).toBe(valor);
        }
      }
    });

    it('não manda HSTS fora de produção', async () => {
      // Sob HTTP puro o navegador ignora, e em desenvolvimento atrapalha:
      // uma vez recebido, ele força HTTPS no domínio inteiro por um ano.
      const resposta = await requisicao({ method: 'GET', url: '/health' });
      expect(resposta.headers['strict-transport-security']).toBeUndefined();
    });
  });

  describe('log de requisição', () => {
    it('responde quem, qual empresa, qual interface, o quê e quanto tempo', async () => {
      const token = await entrar();
      await requisicao({ method: 'GET', url: '/api/v1/crm/customers', token });

      const linha = ultimaDe('/api/v1/crm/customers');
      expect(linha).toBeDefined();
      expect(linha?.method).toBe('GET');
      expect(linha?.status).toBe(200);
      expect(linha?.channel).toBe('rest');
      expect(linha?.tenantId).toBe(empresa.tenantId);
      expect(linha?.actorKind).toBe('user');
      expect(linha?.actorId).toBe(empresa.userId);
      expect(linha?.durationMs).toBeGreaterThanOrEqual(0);
      expect(linha?.correlationId).toMatch(/[0-9a-f-]{36}/);
    });

    it('agrupa pela rota registrada, e não pela URL com o id dentro', async () => {
      const token = await entrar();
      await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers/019a0000-0000-7000-8000-000000000001',
        token,
      });

      // `/customers/:customerId` agrupa; `/customers/<uuid>` criaria uma série
      // de um item só e sumiria no meio das outras.
      const linha = ultimaDe('/api/v1/crm/customers/:customerId');
      expect(linha).toBeDefined();
      expect(linha?.route).not.toContain('019a0000');
    });

    it('a requisição anônima é registrada sem inventar empresa', async () => {
      await requisicao({ method: 'GET', url: '/api/v1/crm/customers' });

      const linha = ultimaDe('/api/v1/crm/customers');
      expect(linha?.status).toBe(401);
      expect(linha?.nivel).toBe('warn');
      expect(linha?.tenantId).toBeUndefined();
      expect(linha?.actorId).toBeUndefined();
    });

    it('nunca registra credencial nem corpo da requisição', async () => {
      const token = await entrar();
      await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Sigilosa' },
      });

      // Uma linha de log atravessa processos, fica guardada por meses e sai da
      // plataforma — o mesmo cuidado que vale para evento de domínio.
      const tudo = JSON.stringify(registradas);
      expect(tudo).not.toContain(token);
      expect(tudo).not.toContain('Construtora Sigilosa');
      expect(tudo).not.toContain(empresa.senha);
    });

    it('erro do servidor sobe o nível da linha', async () => {
      const token = await entrar();
      // Rota inexistente: 404 é do cliente, e o nível acompanha.
      await requisicao({ method: 'GET', url: '/api/v1/nao-existe', token });

      const linha = [...registradas]
        .reverse()
        .find((atual) => atual.status === 404);
      expect(linha?.nivel).toBe('warn');
    });
  });
});
