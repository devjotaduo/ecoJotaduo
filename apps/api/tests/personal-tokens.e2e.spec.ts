import { runMigrations } from '@ecojotaduo/database';
import { PREFIXO_DE_TOKEN_PESSOAL } from '@ecojotaduo/identity';
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
import { prepararBordaHttp } from '../src/http/borda';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';

exigirBancoEmCI();

/**
 * Um token pessoal que não existe.
 *
 * Nomeado, e não literal: o prefixo `ecj_pat_` foi escolhido justamente para
 * que varredores de segredo reconheçam o valor — e o pré-commit deste
 * repositório o reconheceu. A constante evita o falso positivo sem enfraquecer
 * o detector, que é o que se quer nos dois lados.
 */
const TOKEN_INEXISTENTE = `${PREFIXO_DE_TOKEN_PESSOAL}naoexiste`;

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

interface TokenCriado {
  id: string;
  name: string;
  token: string;
  scopes: string[];
  expiresAt: string | null;
}

/**
 * Tokens pessoais de acesso.
 *
 * Existem para o caso em que um programa age em nome de uma PESSOA de forma
 * continuada — o primeiro é um agente de IA num host MCP, que manda cabeçalho
 * fixo e não tem como refazer login a cada quinze minutos.
 *
 * A alternativa seria uma conta de serviço compartilhada, e o que este arquivo
 * guarda é justamente o que se perderia com ela: a identidade da pessoa e o
 * recorte de permissão dela.
 */
describe.skipIf(!temBancoDeTeste)('tokens pessoais (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let empresa: TenantSemeado;
  let outraEmpresa: TenantSemeado;

  async function requisicao(opcoes: {
    method: 'GET' | 'POST' | 'DELETE';
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

  async function emitir(
    sessao: string,
    corpo: Record<string, unknown> = { name: 'agente do LibreChat' },
  ): Promise<TokenCriado> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/auth/personal-tokens',
      token: sessao,
      payload: corpo,
    });
    expect(resposta.statusCode).toBe(201);
    return resposta.json() as TokenCriado;
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
    await dono`truncate table identity_personal_access_tokens cascade`;
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });
    outraEmpresa = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm'],
    });
  });

  describe('o token funciona como a pessoa', () => {
    it('abre as mesmas rotas que a sessão dela abriria', async () => {
      const sessao = await entrar(empresa);
      const { token } = await emitir(sessao);

      const comToken = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token,
      });

      expect(comToken.statusCode).toBe(200);
    });

    it('a trilha registra a PESSOA, não uma conta de serviço', async () => {
      const sessao = await entrar(empresa);
      const { token } = await emitir(sessao);

      await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Alfa' },
      });

      const trilha = await dono<{ actor_id: string; actor_kind: string }[]>`
        select actor_id, actor_kind from audit_events
        where tenant_id = ${empresa.tenantId} and action = 'crm.customer.created'
      `;

      // É isto que uma conta de serviço compartilhada apagaria: com ela, todo
      // agente da empresa apareceria como o mesmo ator.
      expect(trilha).toHaveLength(1);
      expect(trilha[0]?.actor_id).toBe(empresa.userId);
      expect(trilha[0]?.actor_kind).toBe('user');
    });

    it('não alcança mais do que a pessoa alcança', async () => {
      // Papel `member`: sem permissão de negócio. O token pede escopo `*`.
      const semPermissao = await semearTenant(dono, {
        slug: 'empresa-c',
        email: 'carla@empresa-c.com.br',
        modulos: ['crm'],
        papelId: PAPEL_MEMBER,
      });
      const sessao = await entrar(semPermissao);
      const { token } = await emitir(sessao, {
        name: 'tentativa de escalada',
        scopes: ['*'],
      });

      const resposta = await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Construtora Alfa' },
      });

      // O escopo do token é TETO, não concessão: a decisão continua sendo a
      // interseção com os papéis vivos da pessoa.
      expect(resposta.statusCode).toBe(403);
    });

    it('escopo reduzido restringe o agente', async () => {
      const sessao = await entrar(empresa);
      const { token } = await emitir(sessao, {
        name: 'agente somente-leitura',
        scopes: ['crm.customer.read'],
      });

      expect(
        (
          await requisicao({
            method: 'GET',
            url: '/api/v1/crm/customers',
            token,
          })
        ).statusCode,
      ).toBe(200);

      // A pessoa PODE criar cliente; o token dela não pode. É assim que se dá
      // a um agente menos poder do que se tem.
      expect(
        (
          await requisicao({
            method: 'POST',
            url: '/api/v1/crm/customers',
            token,
            payload: { name: 'Construtora Alfa' },
          })
        ).statusCode,
      ).toBe(403);
    });
  });

  describe('o valor sai uma vez', () => {
    it('a listagem devolve a dica, nunca o token', async () => {
      const sessao = await entrar(empresa);
      const criado = await emitir(sessao);

      const lista = await requisicao({
        method: 'GET',
        url: '/api/v1/auth/personal-tokens',
        token: sessao,
      });
      const corpo = lista.json() as {
        items: { id: string; hint: string; name: string }[];
      };

      expect(corpo.items).toHaveLength(1);
      expect(corpo.items[0]?.name).toBe('agente do LibreChat');
      expect(JSON.stringify(corpo)).not.toContain(criado.token);
      // A dica é o começo do valor: reconhece qual revogar, não ajuda a
      // adivinhar o resto.
      expect(criado.token).toContain(corpo.items[0]?.hint ?? '@@@');
    });

    it('o banco guarda só o hash', async () => {
      const sessao = await entrar(empresa);
      const criado = await emitir(sessao);

      const linhas = await dono<{ token_hash: string }[]>`
        select token_hash from identity_personal_access_tokens
      `;

      expect(linhas).toHaveLength(1);
      expect(linhas[0]?.token_hash).not.toContain(criado.token);
    });
  });

  describe('revogação', () => {
    it('vale na requisição seguinte', async () => {
      const sessao = await entrar(empresa);
      const criado = await emitir(sessao);

      expect(
        (
          await requisicao({
            method: 'GET',
            url: '/api/v1/crm/customers',
            token: criado.token,
          })
        ).statusCode,
      ).toBe(200);

      const revogacao = await requisicao({
        method: 'DELETE',
        url: `/api/v1/auth/personal-tokens/${criado.id}`,
        token: sessao,
      });
      expect(revogacao.statusCode).toBe(204);

      // Sem cache de credencial: o acesso é resolvido do banco a cada chamada.
      expect(
        (
          await requisicao({
            method: 'GET',
            url: '/api/v1/crm/customers',
            token: criado.token,
          })
        ).statusCode,
      ).toBe(401);
    });

    it('ninguém revoga o token de outra pessoa', async () => {
      const daEmpresaA = await entrar(empresa);
      const criado = await emitir(daEmpresaA);
      const daEmpresaB = await entrar(outraEmpresa);

      const tentativa = await requisicao({
        method: 'DELETE',
        url: `/api/v1/auth/personal-tokens/${criado.id}`,
        token: daEmpresaB,
      });

      expect(tentativa.statusCode).toBe(404);
      // E continua valendo.
      expect(
        (
          await requisicao({
            method: 'GET',
            url: '/api/v1/crm/customers',
            token: criado.token,
          })
        ).statusCode,
      ).toBe(200);
    });
  });

  describe('um token pessoal não emite outro', () => {
    it('emitir exige sessão de verdade', async () => {
      const sessao = await entrar(empresa);
      const { token } = await emitir(sessao);

      const tentativa = await requisicao({
        method: 'POST',
        url: '/api/v1/auth/personal-tokens',
        token,
        payload: { name: 'sucessor' },
      });

      // Sem esta regra, um token vazado emite sucessores para sempre e revogar
      // o original não adianta — quem o roubou já teria outro.
      expect(tentativa.statusCode).toBe(403);
    });

    it('mas revogar continua possível com o próprio token', async () => {
      const sessao = await entrar(empresa);
      const criado = await emitir(sessao);

      // Quem percebe um vazamento precisa conseguir cortar com o que tem na
      // mão, inclusive de dentro do agente.
      const revogacao = await requisicao({
        method: 'DELETE',
        url: `/api/v1/auth/personal-tokens/${criado.id}`,
        token: criado.token,
      });

      expect(revogacao.statusCode).toBe(204);
    });
  });

  describe('o token pertence a uma empresa', () => {
    it('não enxerga os dados da outra', async () => {
      const sessao = await entrar(empresa);
      const { token } = await emitir(sessao);

      await requisicao({
        method: 'POST',
        url: '/api/v1/crm/customers',
        token,
        payload: { name: 'Cliente da Empresa A' },
      });

      const daOutra = await entrar(outraEmpresa);
      const listaDaOutra = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token: daOutra,
      });

      expect((listaDaOutra.json() as { total: number }).total).toBe(0);
    });

    it('token forjado ou desconhecido é 401', async () => {
      const inventado = await requisicao({
        method: 'GET',
        url: '/api/v1/crm/customers',
        token: TOKEN_INEXISTENTE,
      });

      expect(inventado.statusCode).toBe(401);
    });
  });
});
