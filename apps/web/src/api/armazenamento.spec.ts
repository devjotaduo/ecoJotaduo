import { describe, expect, it } from 'vitest';

import { armazenamentoDaAba } from './armazenamento';

/**
 * A partir da Fase 10 a sessão do navegador vive **só em memória**.
 *
 * Antes, o refresh token ia para o `sessionStorage` para a aba sobreviver a um
 * F5 — e de lá qualquer script injetado o lia. Agora ele está num cookie
 * `httpOnly`, que o navegador envia sozinho e nenhum JavaScript enxerga. O que
 * este teste guarda é a propriedade que sobrou: **nada de sessão é gravado em
 * lugar nenhum acessível a script**.
 */
describe('armazenamento da aba', () => {
  it('não grava nada em storage do navegador', () => {
    sessionStorage.clear();
    localStorage.clear();

    const armazenamento = armazenamentoDaAba();
    armazenamento.gravar({ accessToken: 'token-de-acesso' });

    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('devolve o access token gravado', () => {
    const armazenamento = armazenamentoDaAba();
    armazenamento.gravar({ accessToken: 'token-de-acesso' });

    expect(armazenamento.ler()?.accessToken).toBe('token-de-acesso');
  });

  it('sem sessão, devolve token vazio em vez de null', () => {
    const armazenamento = armazenamentoDaAba();

    // Um `null` faria a tela concluir "não está logado" e pedir senha. Com
    // token vazio o SDK chama sem autorização, toma 401 e renova pelo cookie —
    // que é como uma aba recarregada volta à vida sem senha.
    expect(armazenamento.ler()).toEqual({ accessToken: '' });
  });

  it('sair apaga o que estava em memória', () => {
    const armazenamento = armazenamentoDaAba();
    armazenamento.gravar({ accessToken: 'token-de-acesso' });
    armazenamento.gravar(null);

    expect(armazenamento.ler()?.accessToken).toBe('');
  });

  it('duas abas não compartilham sessão em memória', () => {
    const umaAba = armazenamentoDaAba();
    const outraAba = armazenamentoDaAba();

    umaAba.gravar({ accessToken: 'token-de-acesso' });

    expect(outraAba.ler()?.accessToken).toBe('');
  });
});
