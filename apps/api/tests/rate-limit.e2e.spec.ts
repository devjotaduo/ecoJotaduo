import { loadEnv } from '@ecojotaduo/config';
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
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';
import { registrarLimiteDeRequisicoes } from '../src/http/rate-limit';
import { prepararBordaHttp } from '../src/http/borda';

exigirBancoEmCI();

/** Tetos apertados: o teste precisa estourar o limite, não esperar um minuto. */
const MAX_LOGIN = 3;
const MAX_GERAL = 5;

interface RespostaHttp {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  json(): unknown;
}

/**
 * Fase 10: limite de requisições.
 *
 * O que se protege tem duas naturezas. No login, força bruta contra senha — o
 * custo do scrypt sozinho não contém uma botnet paciente. Nas rotas
 * autenticadas, uso abusivo de uma credencial, que custa banco às outras
 * empresas da mesma instalação.
 *
 * Cada caso monta a aplicação de novo, e não por capricho: o contador vive na
 * memória do processo, então um balde estourado num teste vazaria para os
 * seguintes e eles falhariam por contaminação, não por defeito.
 */
describe.skipIf(!temBancoDeTeste)('limite de requisições (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
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

  function login(senha: string): Promise<RespostaHttp> {
    return requisicao({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: empresa.email,
        password: senha,
        tenantSlug: empresa.slug,
      },
    });
  }

  async function entrar(): Promise<string> {
    const resposta = await login(empresa.senha);
    expect(resposta.statusCode).toBe(200);
    return (resposta.json() as { accessToken: string }).accessToken;
  }

  function listarClientes(token: string): Promise<RespostaHttp> {
    return requisicao({ method: 'GET', url: '/api/v1/crm/customers', token });
  }

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());

    process.env.DATABASE_URL = urlDaAplicacao();
    process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_LOGIN_MAX = String(MAX_LOGIN);
    process.env.RATE_LIMIT_MAX = String(MAX_GERAL);
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
  });

  afterAll(async () => {
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
    delete process.env.RATE_LIMIT_LOGIN_MAX;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW_SECONDS;
  });

  beforeEach(async () => {
    await limparDados(dono);
    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });

    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await prepararBordaHttp(app);
    await registrarLimiteDeRequisicoes(app, loadEnv());
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('força bruta no login para de custar scrypt depois do teto', async () => {
    const status: number[] = [];
    for (let tentativa = 0; tentativa < MAX_LOGIN + 2; tentativa += 1) {
      status.push((await login('senha-errada')).statusCode);
    }

    // As primeiras chegam ao verificador de senha (401); a partir do teto o
    // pedido nem é avaliado.
    expect(status.slice(0, MAX_LOGIN)).toEqual(
      Array.from({ length: MAX_LOGIN }, () => 401),
    );
    expect(status.slice(MAX_LOGIN)).toEqual([429, 429]);
  });

  it('a senha certa também é barrada — o balde é da origem, não do acerto', async () => {
    for (let tentativa = 0; tentativa < MAX_LOGIN; tentativa += 1) {
      await login('senha-errada');
    }

    // Se o acerto passasse por cima do limite, bastaria adivinhar uma vez.
    expect((await login(empresa.senha)).statusCode).toBe(429);
  });

  it('a recusa vem em Problem Details, com retry-after', async () => {
    for (let tentativa = 0; tentativa < MAX_LOGIN; tentativa += 1) {
      await login('senha-errada');
    }
    const barrada = await login('senha-errada');

    expect(barrada.statusCode).toBe(429);
    expect(barrada.headers['retry-after']).toBeDefined();
    const problema = barrada.json() as { type: string; title: string };
    expect(problema.type).toContain('too-many-requests');
    expect(problema.title).toBe('Requisições demais');
  });

  it('o balde do login é separado do das rotas autenticadas', async () => {
    const token = await entrar();

    // Estoura o balde do login...
    for (let tentativa = 0; tentativa < MAX_LOGIN; tentativa += 1) {
      await login('senha-errada');
    }
    expect((await login('senha-errada')).statusCode).toBe(429);

    // ...e a sessão já aberta continua funcionando. Com um balde só, uso
    // normal consumiria a franquia de login, e vice-versa.
    expect((await listarClientes(token)).statusCode).toBe(200);
  });

  it('o teto é por credencial, e não por endereço', async () => {
    const primeira = await entrar();
    const segunda = await entrar();

    for (let chamada = 0; chamada < MAX_GERAL; chamada += 1) {
      await listarClientes(primeira);
    }
    expect((await listarClientes(primeira)).statusCode).toBe(429);

    // A segunda credencial vem do MESMO endereço e não foi afetada — é o que
    // impede que uma pessoa derrube o ERP da empresa inteira atrás do NAT.
    expect((await listarClientes(segunda)).statusCode).toBe(200);
  });

  it('o health check não gasta franquia', async () => {
    for (let chamada = 0; chamada < MAX_GERAL + 5; chamada += 1) {
      expect(
        (await requisicao({ method: 'GET', url: '/health' })).statusCode,
      ).toBe(200);
    }
  });
});
