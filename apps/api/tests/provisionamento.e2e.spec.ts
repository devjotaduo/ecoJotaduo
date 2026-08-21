import { runMigrations } from '@ecojotaduo/database';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  prepararBancoDeTestes,
  temBancoDeTeste,
  urlDaAplicacao,
} from '@ecojotaduo/test-support';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import {
  provisionar,
  type EmpresaProvisionada,
} from '../src/cli/provisionar-empresa';
import { prepararBordaHttp } from '../src/http/borda';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';

exigirBancoEmCI();

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

/**
 * Provisionamento de empresa.
 *
 * O que este arquivo guarda é uma afirmação prática, e não uma linha no banco:
 * depois do comando, a pessoa **entra e trabalha**. Conferir que as linhas
 * foram gravadas provaria só que o INSERT rodou — a empresa poderia nascer sem
 * módulo contratado, sem papel ou com o e-mail em maiúsculas, e cada um desses
 * casos passa pelo banco sem reclamar e falha na cara de quem tenta usar.
 */
describe.skipIf(!temBancoDeTeste)('provisionamento de empresa (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;

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

  /** Faz login e devolve o access token — ou o status, quando recusado. */
  async function entrar(entrada: {
    email: string;
    senha: string;
    slug: string;
  }): Promise<{ statusCode: number; accessToken?: string }> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: entrada.email,
        password: entrada.senha,
        tenantSlug: entrada.slug,
      },
    });
    return {
      statusCode: resposta.statusCode,
      accessToken: (resposta.json() as { accessToken?: string }).accessToken,
    };
  }

  async function sessaoDe(empresa: EmpresaProvisionada): Promise<string> {
    expect(empresa.senha).not.toBeNull();
    const { statusCode, accessToken } = await entrar({
      email: empresa.email,
      senha: empresa.senha as string,
      slug: empresa.slug,
    });
    expect(statusCode).toBe(200);
    return accessToken as string;
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
  });

  afterAll(async () => {
    await app?.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);
  });

  describe('a empresa nasce utilizável', () => {
    it('a pessoa entra com a senha que o comando mostrou', async () => {
      const empresa = await provisionar(dono, {
        slug: 'transportes-lima',
        nome: 'Transportes Lima',
        email: 'clara@transporteslima.com.br',
      });

      const { statusCode } = await entrar({
        email: empresa.email,
        senha: empresa.senha as string,
        slug: 'transportes-lima',
      });

      expect(statusCode).toBe(200);
    });

    it('e trabalha: as rotas de negócio respondem, não 403 de módulo', async () => {
      // A prova que interessa. Uma empresa criada sem entitlement existe no
      // banco e é inútil: todo módulo devolve 403 e o catálogo MCP vem vazio.
      const empresa = await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'clara@transporteslima.com.br',
      });
      const sessao = await sessaoDe(empresa);

      const clientes = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token: sessao,
      });

      expect(clientes.statusCode).toBe(200);
    });

    it('a primeira pessoa é dona: administra os módulos da empresa', async () => {
      const empresa = await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'clara@transporteslima.com.br',
      });
      const sessao = await sessaoDe(empresa);

      // `platform.module.manage` só o papel de proprietário concede.
      const modulos = await requisicao({
        method: 'GET',
        url: '/api/v1/modules',
        token: sessao,
      });

      expect(modulos.statusCode).toBe(200);
    });

    it('normaliza o e-mail — quem digita com maiúsculas consegue entrar', async () => {
      const empresa = await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'Clara@TransportesLima.com.BR',
      });

      expect(empresa.email).toBe('clara@transporteslima.com.br');
      await expect(sessaoDe(empresa)).resolves.toBeTruthy();
    });
  });

  describe('rodar de novo não estraga nada', () => {
    it('não duplica a empresa nem troca a senha de quem já entrava', async () => {
      const primeira = await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'clara@transporteslima.com.br',
      });

      const segunda = await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'clara@transporteslima.com.br',
      });

      expect(segunda.jaExistia).toBe(true);
      expect(segunda.tenantId).toBe(primeira.tenantId);
      // Nenhuma senha nova é anunciada: a de quem já usava continua valendo.
      expect(segunda.senha).toBeNull();

      const { statusCode } = await entrar({
        email: primeira.email,
        senha: primeira.senha as string,
        slug: primeira.slug,
      });
      expect(statusCode).toBe(200);
    });

    it('contrata o módulo que passou a existir depois', async () => {
      await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'clara@transporteslima.com.br',
        modulos: ['crm'],
      });
      const depois = await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'clara@transporteslima.com.br',
        modulos: ['crm', 'commercial'],
      });

      expect(depois.modulosContratados).toContain('commercial');

      const contratados = await dono<{ module_id: string }[]>`
        select module_id from tenancy_module_entitlements
        where tenant_id = ${depois.tenantId}
      `;
      expect(contratados.map((linha) => linha.module_id).sort()).toEqual(
        ['commercial', 'crm', 'identity', 'tenancy'].sort(),
      );
    });
  });

  describe('a mesma pessoa em duas empresas', () => {
    it('reusa a conta e mantém a senha — e ela entra nas duas', async () => {
      const primeira = await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'clara@exemplo.com.br',
      });
      const segunda = await provisionar(dono, {
        slug: 'lima-agricola',
        email: 'clara@exemplo.com.br',
      });

      // Senha alheia não se sobrescreve: quem já entrava continua entrando.
      expect(segunda.senha).toBeNull();
      expect(segunda.pessoaJaExistia).toBe(true);
      expect(segunda.tenantId).not.toBe(primeira.tenantId);

      for (const slug of ['transportes-lima', 'lima-agricola']) {
        const { statusCode } = await entrar({
          email: 'clara@exemplo.com.br',
          senha: primeira.senha as string,
          slug,
        });
        expect(statusCode).toBe(200);
      }
    });

    it('cada empresa continua sendo um escopo próprio', async () => {
      const primeira = await provisionar(dono, {
        slug: 'transportes-lima',
        email: 'clara@exemplo.com.br',
      });
      await provisionar(dono, {
        slug: 'lima-agricola',
        email: 'clara@exemplo.com.br',
      });

      const sessao = await sessaoDe(primeira);
      await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token: sessao,
        payload: { name: 'Cliente da primeira', kind: 'company' },
      });

      const naOutra = await entrar({
        email: 'clara@exemplo.com.br',
        senha: primeira.senha as string,
        slug: 'lima-agricola',
      });
      const clientes = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token: naOutra.accessToken,
      });

      expect(clientes.statusCode).toBe(200);
      expect((clientes.json() as { items: unknown[] }).items).toHaveLength(0);
    });
  });

  describe('recusa o que criaria uma empresa quebrada', () => {
    it('módulo que não existe nesta instalação', async () => {
      await expect(
        provisionar(dono, {
          slug: 'transportes-lima',
          email: 'clara@exemplo.com.br',
          modulos: ['crm-v2'],
        }),
      ).rejects.toThrow(/crm-v2/);
    });

    it('slug que não serve de identificador de login', async () => {
      await expect(
        provisionar(dono, {
          slug: 'Transportes Lima',
          email: 'clara@exemplo.com.br',
        }),
      ).rejects.toThrow(/slug/i);
    });

    it('e-mail inválido', async () => {
      await expect(
        provisionar(dono, { slug: 'transportes-lima', email: 'clara' }),
      ).rejects.toThrow();
    });
  });
});
