import type { ArmazenamentoDeSessao, Sessao } from '@ecojotaduo/api-client';

/**
 * Onde a sessão vive no navegador: **só em memória**.
 *
 * Nada de sessão é gravado em `sessionStorage` ou `localStorage`. O access
 * token fica nesta closure e some ao recarregar a página; o refresh token
 * nunca chega ao JavaScript — ele vive num cookie `httpOnly` que o navegador
 * envia sozinho e nenhum script lê, nem este.
 *
 * A aba sobrevive a um F5 assim: ao carregar, não há access token, a primeira
 * chamada toma 401 e o SDK renova usando o cookie. É o mesmo caminho de antes,
 * com a diferença de que agora um XSS não tem o que roubar — ele consegue agir
 * enquanto a página está aberta, mas não leva a sessão embora.
 */
export function armazenamentoDaAba(): ArmazenamentoDeSessao {
  let sessao: Sessao | null = null;

  return {
    ler(): Sessao | null {
      /**
       * Depois de recarregar a página não há access token. Devolver uma sessão
       * com token vazio faz o SDK chamar sem cabeçalho de autorização, tomar
       * 401 e renovar pelo cookie — que é exatamente o caminho desejado. Um
       * `null` aqui faria a tela concluir "não está logado" e pedir senha de
       * novo, jogando fora a sessão que ainda existe no servidor.
       */
      return sessao ?? { accessToken: '' };
    },

    gravar(nova: Sessao | null): void {
      sessao = nova;
    },
  };
}
