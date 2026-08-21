import { erroDaResposta } from './errors';

/**
 * A sessão que o SDK guarda é só o access token.
 *
 * O refresh token **não passa por aqui**: ele vive num cookie `httpOnly`
 * emitido pela API, que o navegador envia sozinho e nenhum script lê — nem
 * este. Guardá-lo em JavaScript seria desfazer a proteção inteira.
 */
export interface Sessao {
  readonly accessToken: string;
  /** Quando o access token expira; a tela usa para antecipar a renovação. */
  readonly expiraEm?: string;
}

/**
 * Onde a sessão vive. A web guarda em memória, o teste em um objeto — o SDK
 * não decide isso.
 */
export interface ArmazenamentoDeSessao {
  ler(): Sessao | null;
  gravar(sessao: Sessao | null): void;
}

export function armazenamentoEmMemoria(inicial: Sessao | null = null) {
  let atual = inicial;
  return {
    ler: () => atual,
    gravar: (sessao: Sessao | null) => {
      atual = sessao;
    },
  } satisfies ArmazenamentoDeSessao;
}

/**
 * Renovação de sessão com "single-flight".
 *
 * Se três requisições receberem 401 ao mesmo tempo, uma única renovação
 * acontece e as outras esperam por ela. Sem isso, as três rotacionariam o
 * refresh token em paralelo — e a rotação do servidor trata reuso como
 * vazamento, derrubando a sessão inteira do usuário.
 *
 * A chamada não leva corpo: o refresh token vai no cookie. Por isso
 * `credentials: 'include'`, sem o qual o navegador não o enviaria em nenhuma
 * requisição feita por `fetch`.
 */
export class RenovadorDeSessao {
  private emAndamento: Promise<Sessao | null> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly armazenamento: ArmazenamentoDeSessao,
    private readonly fetchInterno: typeof fetch,
  ) {}

  renovar(): Promise<Sessao | null> {
    this.emAndamento ??= this.executar().finally(() => {
      this.emAndamento = null;
    });
    return this.emAndamento;
  }

  private async executar(): Promise<Sessao | null> {
    const resposta = await this.fetchInterno(
      `${this.baseUrl}/api/v1/auth/refresh`,
      {
        method: 'POST',
        credentials: 'include',
      },
    );

    if (!resposta.ok) {
      // Renovação recusada: a sessão acabou. Limpar evita repetir a tentativa
      // a cada chamada seguinte.
      this.armazenamento.gravar(null);
      if (resposta.status >= 500) {
        throw await erroDaResposta(resposta);
      }
      return null;
    }

    const corpo = (await resposta.json()) as {
      accessToken: string;
      accessTokenExpiresAt?: string;
    };
    const nova: Sessao = {
      accessToken: corpo.accessToken,
      expiraEm: corpo.accessTokenExpiresAt,
    };
    this.armazenamento.gravar(nova);
    return nova;
  }
}
