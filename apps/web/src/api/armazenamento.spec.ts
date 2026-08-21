import { beforeEach, describe, expect, it } from 'vitest';

import { armazenamentoDaAba } from './armazenamento';

/** `sessionStorage` de mentira, para o teste não depender do jsdom. */
function storageFalso(): Storage {
  const dados = new Map<string, string>();
  return {
    get length() {
      return dados.size;
    },
    clear: () => dados.clear(),
    getItem: (chave: string) => dados.get(chave) ?? null,
    key: (indice: number) => [...dados.keys()][indice] ?? null,
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
  };
}

describe('armazenamento da aba', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = storageFalso();
  });

  it('sem sessão, devolve null', () => {
    expect(armazenamentoDaAba(storage).ler()).toBeNull();
  });

  it('guarda o refresh token e devolve os dois', () => {
    const armazenamento = armazenamentoDaAba(storage);
    armazenamento.gravar({ accessToken: 'acesso', refreshToken: 'renovacao' });

    expect(armazenamento.ler()).toEqual({
      accessToken: 'acesso',
      refreshToken: 'renovacao',
    });
  });

  it('o ACCESS TOKEN nunca vai para o storage', () => {
    // É o que abre todas as rotas sem nenhuma volta ao servidor: fora da
    // memória, um vazamento não seria nem detectável nem revogável.
    const armazenamento = armazenamentoDaAba(storage);
    armazenamento.gravar({ accessToken: 'acesso', refreshToken: 'renovacao' });

    const gravado = JSON.stringify([...Object.entries(storage)]);
    expect(storage.getItem('ecojotaduo.refresh')).toBe('renovacao');
    expect(gravado).not.toContain('acesso');
  });

  it('depois de recarregar a página, sobra só o refresh', () => {
    // Simula o F5: mesmo storage, instância nova (a memória se perdeu).
    armazenamentoDaAba(storage).gravar({
      accessToken: 'acesso',
      refreshToken: 'renovacao',
    });

    const depoisDoReload = armazenamentoDaAba(storage);
    expect(depoisDoReload.ler()).toEqual({
      accessToken: '',
      refreshToken: 'renovacao',
    });
    // Access token vazio faz o SDK chamar sem credencial, tomar 401 e renovar
    // — que é exatamente o caminho desejado.
  });

  it('sair limpa o storage', () => {
    const armazenamento = armazenamentoDaAba(storage);
    armazenamento.gravar({ accessToken: 'a', refreshToken: 'r' });
    armazenamento.gravar(null);

    expect(storage.getItem('ecojotaduo.refresh')).toBeNull();
    expect(armazenamento.ler()).toBeNull();
  });
});
