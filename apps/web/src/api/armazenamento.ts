import type { ArmazenamentoDeSessao, Sessao } from '@ecojotaduo/api-client';

const CHAVE = 'ecojotaduo.refresh';

/**
 * Onde a sessão vive no navegador.
 *
 * O **access token fica só em memória** e some ao recarregar a página. O
 * refresh token vai para o `sessionStorage`, para a aba sobreviver a um F5 sem
 * pedir senha de novo — e morre quando a aba fecha.
 *
 * Não guardar o access token não é firula: ele é o que abre TODAS as rotas
 * agora, sem nenhuma volta ao servidor. O refresh, sozinho, ainda passa pela
 * rotação com detecção de reuso (ADR-0007), então um vazamento dele é
 * detectável e revogável; o access token vazado não é nem uma coisa nem outra
 * até expirar.
 *
 * **Isto NÃO protege contra XSS** — script injetado lê `sessionStorage` do
 * mesmo jeito. A correção durável é cookie `httpOnly` + CSRF, que exige
 * mudança na API e está declarada como dívida no roadmap.
 */
export function armazenamentoDaAba(
  storage: Storage = sessionStorage,
): ArmazenamentoDeSessao {
  let accessToken: string | null = null;

  return {
    ler(): Sessao | null {
      const refreshToken = storage.getItem(CHAVE);
      if (!refreshToken) {
        return null;
      }
      /**
       * Depois de recarregar a página o access token não existe mais. Devolver
       * string vazia faz o SDK chamar sem cabeçalho de autorização, tomar 401
       * e renovar — que é exatamente o caminho desejado.
       */
      return { accessToken: accessToken ?? '', refreshToken };
    },

    gravar(sessao: Sessao | null): void {
      accessToken = sessao?.accessToken ?? null;
      if (sessao?.refreshToken) {
        storage.setItem(CHAVE, sessao.refreshToken);
      } else {
        storage.removeItem(CHAVE);
      }
    },
  };
}
