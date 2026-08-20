import { erroDaResposta } from './errors';

export interface Sessao {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * Onde a sessão vive. A web pode guardar em memória, o mobile em storage
 * seguro, o teste em um objeto — o SDK não decide isso.
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
    const atual = this.armazenamento.ler();
    if (!atual?.refreshToken) {
      return null;
    }

    const resposta = await this.fetchInterno(
      `${this.baseUrl}/api/v1/auth/refresh`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: atual.refreshToken }),
      },
    );

    if (!resposta.ok) {
      // Refresh recusado: a sessão acabou. Limpar evita repetir a tentativa
      // a cada chamada seguinte.
      this.armazenamento.gravar(null);
      if (resposta.status >= 500) {
        throw await erroDaResposta(resposta);
      }
      return null;
    }

    const corpo = (await resposta.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    const nova = {
      accessToken: corpo.accessToken,
      refreshToken: corpo.refreshToken,
    };
    this.armazenamento.gravar(nova);
    return nova;
  }
}
