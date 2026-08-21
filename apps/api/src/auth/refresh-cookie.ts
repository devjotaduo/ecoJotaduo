import type { Env } from '@ecojotaduo/config';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const COOKIE_DE_RENOVACAO = 'ecojotaduo_refresh';

/**
 * O refresh token vive num cookie `httpOnly`, e não no corpo da resposta.
 *
 * Antes desta fase ele ia no JSON, e a aplicação web o guardava no
 * `sessionStorage` — de onde qualquer script injetado o lê. Num cookie
 * `httpOnly` o navegador o envia mas **nenhum JavaScript o enxerga**, nem o
 * nosso. É a diferença entre um XSS levar a sessão embora e um XSS conseguir
 * agir só enquanto a página está aberta.
 *
 * Por que **não** existe token de CSRF junto:
 *
 * - O access token continua fora de cookie, em memória, e vai como `Bearer`.
 *   Ou seja, NENHUMA rota de negócio é autenticada por cookie — um POST
 *   forjado de outro site chega sem autorização nenhuma.
 * - O único endpoint que lê o cookie é `/auth/refresh`, e ele está protegido
 *   por `sameSite: 'strict'` mais `path` restrito: uma requisição vinda de
 *   outro site simplesmente não carrega o cookie.
 * - Um token de CSRF aqui fecharia uma porta que já não abre, ao custo de mais
 *   uma peça para manter em sincronia entre servidor, SDK e tela.
 *
 * A consequência de implantação, que vale registrar: a aplicação web e a API
 * precisam ser **same-site** em produção. Em desenvolvimento o Vite já
 * encaminha `/api`, então a origem é a mesma.
 */
export function opcoesDoCookie(env: Env): CookieSerializeOptions {
  return {
    httpOnly: true,
    // Fora de produção o navegador de desenvolvimento fala HTTP puro; exigir
    // `secure` ali faria o cookie ser descartado em silêncio.
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    // Só as rotas de sessão recebem o cookie. Uma falha em qualquer outra rota
    // não tem como fazer o navegador entregá-lo.
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
}

export function gravarCookieDeRenovacao(
  resposta: FastifyReply,
  env: Env,
  token: string,
): void {
  void resposta.setCookie(COOKIE_DE_RENOVACAO, token, opcoesDoCookie(env));
}

/** Apaga o cookie — mesmo `path` e atributos, senão o navegador ignora. */
export function limparCookieDeRenovacao(
  resposta: FastifyReply,
  env: Env,
): void {
  void resposta.clearCookie(COOKIE_DE_RENOVACAO, {
    ...opcoesDoCookie(env),
    maxAge: 0,
  });
}

export function lerCookieDeRenovacao(
  requisicao: FastifyRequest,
): string | undefined {
  const valor = requisicao.cookies?.[COOKIE_DE_RENOVACAO];
  return valor && valor.length > 0 ? valor : undefined;
}
