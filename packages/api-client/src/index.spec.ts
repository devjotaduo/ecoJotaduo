import { describe, expect, it } from 'vitest';

import { criarClienteDaApi, ouFalhar } from './index';
import type { paths } from './schema';
import { ApiError, erroDaResposta } from './errors';
import { armazenamentoEmMemoria } from './sessao';

/**
 * Trava de tipo: falha a compilação se `paths` degradar para `any`.
 *
 * Foi exatamente o que aconteceu quando o schema era um `.d.ts` em `src/` — o
 * tsc não o copia para `dist/`, então o import quebrava no consumidor e TODA a
 * tipagem do SDK virava `any` silenciosamente. Nenhum teste de runtime pega
 * isso; esta linha pega.
 */
type EhAny<T> = 0 extends 1 & T ? true : false;
type PathsEstaoTipados = EhAny<paths> extends true ? never : true;
const _tipagemPreservada: PathsEstaoTipados = true;
void _tipagemPreservada;

const BASE = 'https://api.exemplo.test';

function resposta(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problema(status: number, slug: string, detail = 'erro') {
  return resposta(status, {
    type: `https://jotaduo.com/ecojotaduo/errors/${slug}`,
    title: 'Erro',
    status,
    detail,
    instance: '/api/v1/crm/customers',
    correlationId: 'corr-1',
  });
}

describe('cliente da API', () => {
  it('envia o token da sessão e um correlation id em cada requisição', async () => {
    const chamadas: Request[] = [];
    const cliente = criarClienteDaApi({
      baseUrl: BASE,
      armazenamento: armazenamentoEmMemoria({
        accessToken: 'token-1',
        refreshToken: 'refresh-1',
      }),
      fetch: (entrada, init) => {
        chamadas.push(new Request(entrada, init));
        return Promise.resolve(resposta(200, { items: [], total: 0 }));
      },
    });

    await cliente.rotas.GET('/api/v1/crm/customers', {
      params: { query: { limit: 10, offset: 0 } },
    });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.headers.get('authorization')).toBe('Bearer token-1');
    expect(chamadas[0]?.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('correlation id é diferente a cada requisição', async () => {
    const ids: (string | null)[] = [];
    const cliente = criarClienteDaApi({
      baseUrl: BASE,
      fetch: (entrada, init) => {
        ids.push(new Request(entrada, init).headers.get('x-correlation-id'));
        return Promise.resolve(resposta(200, { status: 'ok' }));
      },
    });

    await cliente.rotas.GET('/health');
    await cliente.rotas.GET('/health');

    expect(ids[0]).not.toBe(ids[1]);
  });

  describe('renovação de sessão', () => {
    it('renova ao receber 401 e repete a requisição uma vez', async () => {
      const armazenamento = armazenamentoEmMemoria({
        accessToken: 'expirado',
        refreshToken: 'refresh-1',
      });
      const tokensUsados: (string | null)[] = [];
      let renovacoes = 0;

      const cliente = criarClienteDaApi({
        baseUrl: BASE,
        armazenamento,
        fetch: (entrada, init) => {
          const requisicao = new Request(entrada, init);
          const url = requisicao.url;

          if (url.includes('/auth/refresh')) {
            renovacoes += 1;
            return Promise.resolve(
              resposta(200, {
                accessToken: 'token-novo',
                refreshToken: 'refresh-2',
              }),
            );
          }

          const token = requisicao.headers.get('authorization');
          tokensUsados.push(token);
          return Promise.resolve(
            token === 'Bearer token-novo'
              ? resposta(200, { items: [], total: 0 })
              : problema(401, 'unauthorized'),
          );
        },
      });

      const { data } = await cliente.rotas.GET('/api/v1/crm/customers', {
        params: { query: { limit: 10, offset: 0 } },
      });

      expect(renovacoes).toBe(1);
      expect(tokensUsados).toEqual(['Bearer expirado', 'Bearer token-novo']);
      expect(data).toEqual({ items: [], total: 0 });
      expect(armazenamento.ler()?.refreshToken).toBe('refresh-2');
    });

    it('três 401 simultâneos disparam UMA única renovação', async () => {
      // Renovar em paralelo rotacionaria o refresh token três vezes; o
      // servidor trata reuso como vazamento e derruba a sessão inteira.
      let renovacoes = 0;
      const cliente = criarClienteDaApi({
        baseUrl: BASE,
        armazenamento: armazenamentoEmMemoria({
          accessToken: 'expirado',
          refreshToken: 'refresh-1',
        }),
        fetch: async (entrada, init) => {
          const requisicao = new Request(entrada, init);
          const url = requisicao.url;
          if (url.includes('/auth/refresh')) {
            renovacoes += 1;
            await new Promise((resolver) => setTimeout(resolver, 20));
            return resposta(200, {
              accessToken: 'token-novo',
              refreshToken: 'refresh-2',
            });
          }
          const token = requisicao.headers.get('authorization');
          return token === 'Bearer token-novo'
            ? resposta(200, { items: [], total: 0 })
            : problema(401, 'unauthorized');
        },
      });

      const consulta = { params: { query: { limit: 10, offset: 0 } } } as const;
      await Promise.all([
        cliente.rotas.GET('/api/v1/crm/customers', consulta),
        cliente.rotas.GET('/api/v1/crm/customers', consulta),
        cliente.rotas.GET('/api/v1/crm/customers', consulta),
      ]);

      expect(renovacoes).toBe(1);
    });

    it('não tenta renovar quando não há sessão', async () => {
      let renovacoes = 0;
      const cliente = criarClienteDaApi({
        baseUrl: BASE,
        fetch: (entrada, init) => {
          const url = new Request(entrada, init).url;
          if (url.includes('/auth/refresh')) renovacoes += 1;
          return Promise.resolve(problema(401, 'unauthorized'));
        },
      });

      await cliente.rotas.GET('/api/v1/auth/me');

      expect(renovacoes).toBe(0);
    });

    it('refresh recusado limpa a sessão e não repete indefinidamente', async () => {
      const armazenamento = armazenamentoEmMemoria({
        accessToken: 'expirado',
        refreshToken: 'vazado',
      });
      let tentativas = 0;

      const cliente = criarClienteDaApi({
        baseUrl: BASE,
        armazenamento,
        fetch: () => {
          tentativas += 1;
          return Promise.resolve(
            problema(401, 'unauthorized', 'Refresh token inválido.'),
          );
        },
      });

      await cliente.rotas.GET('/api/v1/auth/me');

      // 1 chamada original + 1 tentativa de refresh, e para por aí.
      expect(tentativas).toBe(2);
      expect(armazenamento.ler()).toBeNull();
    });
  });

  describe('login', () => {
    it('guarda a sessão devolvida pelo servidor', async () => {
      const cliente = criarClienteDaApi({
        baseUrl: BASE,
        fetch: () =>
          Promise.resolve(
            resposta(200, {
              accessToken: 'a',
              refreshToken: 'r',
              accessTokenExpiresAt: new Date().toISOString(),
              refreshTokenExpiresAt: new Date().toISOString(),
              tenant: { id: 't', slug: 'empresa', name: 'Empresa' },
              user: { id: 'u', name: 'Ana', email: 'ana@a.com' },
              permissions: ['*'],
              entitlements: ['crm'],
            }),
          ),
      });

      const sessao = await cliente.entrar({
        email: 'ana@a.com',
        password: 'x',
        tenantSlug: 'empresa',
      });

      expect(sessao.accessToken).toBe('a');
      expect(cliente.sessaoAtual()?.refreshToken).toBe('r');
    });

    it('credencial errada vira ApiError com o correlationId', async () => {
      const cliente = criarClienteDaApi({
        baseUrl: BASE,
        fetch: () =>
          Promise.resolve(
            problema(401, 'unauthorized', 'Credenciais inválidas.'),
          ),
      });

      const erro = await cliente
        .entrar({ email: 'a@a.com', password: 'errada', tenantSlug: 'empresa' })
        .catch((causa: unknown) => causa);

      expect(erro).toBeInstanceOf(ApiError);
      expect((erro as ApiError).naoAutenticado).toBe(true);
      expect((erro as ApiError).correlationId).toBe('corr-1');
    });

    it('sair descarta a sessão', async () => {
      const cliente = criarClienteDaApi({
        baseUrl: BASE,
        armazenamento: armazenamentoEmMemoria({
          accessToken: 'a',
          refreshToken: 'r',
        }),
        fetch: () => Promise.resolve(resposta(200, {})),
      });

      cliente.sair();

      expect(cliente.sessaoAtual()).toBeNull();
      await expect(cliente.rotas.GET('/health')).resolves.toBeDefined();
    });
  });

  describe('interpretação de erro', () => {
    it('classifica módulo não contratado, sem permissão e validação', async () => {
      const casos = [
        {
          slug: 'module-not-entitled',
          status: 403,
          campo: 'moduloNaoContratado',
        },
        { slug: 'forbidden', status: 403, campo: 'semPermissao' },
        { slug: 'tenant-inactive', status: 403, campo: 'empresaInativa' },
      ] as const;

      for (const caso of casos) {
        const cliente = criarClienteDaApi({
          baseUrl: BASE,
          fetch: () => Promise.resolve(problema(caso.status, caso.slug)),
        });
        const erro = (await ouFalhar(
          cliente.rotas.GET('/api/v1/auth/me'),
        ).catch((causa: unknown) => causa)) as ApiError;

        expect(erro[caso.campo], caso.slug).toBe(true);
        expect(erro.correlationId, caso.slug).toBe('corr-1');
      }
    });

    it('resposta sem corpo JSON ainda vira ApiError legível', async () => {
      const erro = await erroDaResposta(
        new Response('<html>502</html>', { status: 502 }),
      );

      expect(erro).toBeInstanceOf(ApiError);
      expect(erro.status).toBe(502);
      expect(erro.message).toContain('502');
    });
  });
});
