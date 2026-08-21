import createClient, { type Client } from 'openapi-fetch';

import { ApiError, erroDaResposta, type ProblemaDetalhado } from './errors';
import type { paths } from './schema';
import {
  armazenamentoEmMemoria,
  RenovadorDeSessao,
  type ArmazenamentoDeSessao,
  type Sessao,
} from './sessao';

export * from './errors';
export * from './sessao';
export type { paths } from './schema';

const HEADER_CORRELACAO = 'x-correlation-id';

export interface OpcoesDoCliente {
  readonly baseUrl: string;
  readonly armazenamento?: ArmazenamentoDeSessao;
  /** Injetável para teste; por padrão o fetch global. */
  readonly fetch?: typeof fetch;
  /** Gera o id de correlação de cada requisição. */
  readonly correlationId?: () => string;
}

export interface ClienteDaApi {
  /** Rotas tipadas a partir do OpenAPI (`GET`, `POST`, `DELETE`). */
  readonly rotas: Client<paths>;
  entrar(entrada: {
    email: string;
    password: string;
    tenantSlug: string;
  }): Promise<Sessao>;
  /**
   * Encerra a sessão. Assíncrona porque o refresh token está num cookie
   * `httpOnly`: só o servidor consegue apagá-lo, e é ele quem revoga a
   * família — sair numa aba tem de valer nas outras.
   */
  sair(): Promise<void>;
  sessaoAtual(): Sessao | null;
}

/**
 * Cliente único da API.
 *
 * Concentra o que não deve ficar espalhado pela aplicação (briefing, seção 11):
 * autenticação, renovação de token, correlação, tratamento de erro e tipagem.
 * Os tipos vêm do `openapi.json` gerado do código — não existe tipo escrito à
 * mão duplicando o contrato.
 */
export function criarClienteDaApi(opcoes: OpcoesDoCliente): ClienteDaApi {
  const armazenamento = opcoes.armazenamento ?? armazenamentoEmMemoria();
  const fetchBase = opcoes.fetch ?? globalThis.fetch;
  const novaCorrelacao = opcoes.correlationId ?? (() => crypto.randomUUID());
  const renovador = new RenovadorDeSessao(
    opcoes.baseUrl,
    armazenamento,
    fetchBase,
  );

  function prepararTentativa(original: Request, token?: string): Request {
    // Clonar antes de enviar: o corpo de um Request só pode ser lido uma vez,
    // e a repetição pós-renovação precisa dele intacto.
    const tentativa = original.clone();
    tentativa.headers.set(HEADER_CORRELACAO, novaCorrelacao());
    if (token) {
      tentativa.headers.set('authorization', `Bearer ${token}`);
    }
    return tentativa;
  }

  /**
   * Fetch da casa: injeta credencial e correlação, e reage a 401 renovando a
   * sessão uma única vez. A segunda falha é definitiva — repetir em laço só
   * transformaria sessão expirada em tempestade de requisições.
   */
  const fetchDaCasa: typeof fetch = async (entrada, init) => {
    // O openapi-fetch entrega um Request pronto; normalizar aqui deixa o
    // resto do fluxo com um formato só para lidar.
    const original = new Request(entrada, init);
    const ehRotaDeSessao =
      original.url.includes('/auth/refresh') ||
      original.url.includes('/auth/login');

    const primeira = await fetchBase(
      prepararTentativa(original, armazenamento.ler()?.accessToken),
    );

    if (primeira.status !== 401 || ehRotaDeSessao) {
      return primeira;
    }

    const renovada = await renovador.renovar();
    if (!renovada) {
      return primeira;
    }

    return fetchBase(prepararTentativa(original, renovada.accessToken));
  };

  const rotas = createClient<paths>({
    baseUrl: opcoes.baseUrl,
    fetch: fetchDaCasa,
  });

  return {
    rotas,

    async entrar(entrada) {
      const { data, error, response } = await rotas.POST('/api/v1/auth/login', {
        body: entrada,
      });
      if (!data) {
        throw await erroDaChamada(error, response);
      }

      const sessao: Sessao = {
        accessToken: data.accessToken,
        expiraEm: data.accessTokenExpiresAt,
      };
      armazenamento.gravar(sessao);
      return sessao;
    },

    async sair() {
      // Limpa o local primeiro: mesmo que a chamada falhe (rede caiu, servidor
      // fora), a aba não fica se comportando como autenticada.
      armazenamento.gravar(null);
      await fetchBase(`${opcoes.baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => undefined);
    },

    sessaoAtual: () => armazenamento.ler(),
  };
}

/**
 * Desempacota a resposta: devolve o dado ou lança `ApiError`.
 *
 * O `openapi-fetch` devolve `{ data, error }` justamente para não lançar; em
 * código de tela isso vira um `if` a cada chamada. Quem preferir tratar erro
 * com try/catch envolve a chamada aqui.
 */
export async function ouFalhar<R extends ResultadoDeChamada>(
  chamada: Promise<R>,
): Promise<NonNullable<R['data']>> {
  const { data, error, response } = await chamada;
  if (data === undefined) {
    throw await erroDaChamada(error, response);
  }
  return data as NonNullable<R['data']>;
}

/**
 * Formato que o `openapi-fetch` devolve: uma UNIÃO de "deu certo" e "deu erro".
 * O genérico precisa capturar a união inteira (`R`) e só então extrair `data` —
 * declarar `data?: T` faria o TypeScript desistir da inferência e devolver
 * `any`, jogando fora justamente a tipagem que o SDK existe para dar.
 */
interface ResultadoDeChamada {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/**
 * Monta o ApiError preferindo o corpo que o openapi-fetch já leu.
 *
 * Reler a `Response` daria vazio — o corpo só pode ser consumido uma vez, e
 * quem consumiu foi ele. Sem isso o Problem Details (com `correlationId` e
 * `type`) se perderia justamente no caminho de erro.
 */
async function erroDaChamada(
  erroLido: unknown,
  resposta: Response,
): Promise<ApiError> {
  if (
    typeof erroLido === 'object' &&
    erroLido !== null &&
    'status' in erroLido &&
    'type' in erroLido
  ) {
    return new ApiError(erroLido as ProblemaDetalhado);
  }
  return erroDaResposta(resposta);
}

export { ApiError };
