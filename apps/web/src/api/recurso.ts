import { useCallback, useEffect, useState } from 'react';

import { mensagemDeErro } from './sessao';

export interface Recurso<T> {
  readonly dados: T | null;
  readonly carregando: boolean;
  readonly erro: string | null;
  readonly recarregar: () => void;
}

/**
 * Carrega um recurso da API com estado de carregamento, erro e recarga.
 *
 * É um hook de 30 linhas em vez de uma biblioteca de cache: com meia dúzia de
 * telas, cache e invalidação seriam configuração para um problema que ainda
 * não existe. Entra uma quando a tela pedir (lista compartilhada entre rotas,
 * refetch em foco), não antes.
 */
export function useRecurso<T>(
  buscar: () => Promise<T>,
  dependencias: readonly unknown[],
): Recurso<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- as dependências são declaradas por quem chama
  const executar = useCallback(buscar, dependencias);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    executar()
      .then((resultado) => {
        // Resposta de uma busca antiga não pode sobrescrever a atual.
        if (ativo) setDados(resultado);
      })
      .catch((falha: unknown) => {
        if (ativo) setErro(mensagemDeErro(falha));
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [executar, versao]);

  return {
    dados,
    carregando,
    erro,
    recarregar: useCallback(() => setVersao((atual) => atual + 1), []),
  };
}
