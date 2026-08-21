import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProvedorDeSessao } from '../api/sessao';

import { Login } from './Login';

const fetchOriginal = globalThis.fetch;

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problema(status: number, detail: string): Response {
  return new Response(
    JSON.stringify({
      type: 'https://jotaduo.com/ecojotaduo/errors/unauthorized',
      title: 'Não autenticado',
      status,
      detail,
      instance: '/api/v1/auth/login',
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function preencherEEnviar() {
  fireEvent.change(screen.getByLabelText('Empresa'), {
    target: { value: 'demo' },
  });
  fireEvent.change(screen.getByLabelText('E-mail'), {
    target: { value: 'ana@empresa.com' },
  });
  fireEvent.change(screen.getByLabelText('Senha'), {
    target: { value: 'senha-de-teste-123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('tela de login', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it('entra e guarda apenas o refresh token na aba', async () => {
    // Função tipada, não mock: nada aqui inspeciona chamadas — o que o teste
    // observa é o efeito, que é o refresh token na aba.
    const servidor: typeof fetch = (entrada) => {
      const url = entrada instanceof Request ? entrada.url : String(entrada);
      if (url.includes('/auth/login')) {
        return Promise.resolve(
          respostaJson({
            accessToken: 'token-de-acesso',
            refreshToken: 'token-de-renovacao',
            accessTokenExpiresAt: new Date().toISOString(),
            refreshTokenExpiresAt: new Date().toISOString(),
            tenant: { id: 't-1', slug: 'demo', name: 'Empresa Demo' },
            user: { id: 'u-1', name: 'Ana', email: 'ana@empresa.com' },
            permissions: ['*'],
            entitlements: ['crm'],
          }),
        );
      }
      if (url.includes('/auth/me')) {
        return Promise.resolve(
          respostaJson({
            tenantId: 't-1',
            actor: { kind: 'user', id: 'u-1' },
            permissions: ['*'],
            scopes: ['*'],
            entitlements: ['crm'],
          }),
        );
      }
      return Promise.resolve(
        respostaJson({
          items: [{ tenantId: 't-1', slug: 'demo', name: 'Empresa Demo' }],
        }),
      );
    };
    globalThis.fetch = servidor;

    render(
      <ProvedorDeSessao>
        <Login />
      </ProvedorDeSessao>,
    );
    preencherEEnviar();

    await waitFor(() => {
      expect(sessionStorage.getItem('ecojotaduo.refresh')).toBe(
        'token-de-renovacao',
      );
    });
    // O access token não pode ter passado por aqui.
    expect(JSON.stringify(sessionStorage)).not.toContain('token-de-acesso');
  });

  it('credencial errada mostra a mensagem do servidor, sem adivinhar o motivo', async () => {
    const servidor: typeof fetch = () =>
      Promise.resolve(
        problema(401, 'Credenciais inválidas ou sessão expirada.'),
      );
    globalThis.fetch = servidor;

    render(
      <ProvedorDeSessao>
        <Login />
      </ProvedorDeSessao>,
    );
    preencherEEnviar();

    const aviso = await screen.findByRole('alert');
    expect(aviso.textContent).toBe('Credenciais inválidas ou sessão expirada.');
    expect(sessionStorage.getItem('ecojotaduo.refresh')).toBeNull();
  });

  it('pede empresa junto com as credenciais', () => {
    // O token É de uma empresa: o tenant viaja como claim, nunca como
    // parâmetro de rota. Sem este campo, não há em qual empresa entrar.
    render(
      <ProvedorDeSessao>
        <Login />
      </ProvedorDeSessao>,
    );
    expect(screen.getByLabelText('Empresa')).toBeTruthy();
  });
});
