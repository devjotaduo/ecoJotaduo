import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InvalidEnvError, loadEnv } from './index';

const MINIMO = {
  DATABASE_URL: 'postgresql://app:pwd@localhost:5432/ecojotaduo',
  JWT_SECRET: 'x'.repeat(32),
  SECRETS_KEY: randomBytes(32).toString('base64'),
};

describe('loadEnv', () => {
  it('aplica defaults quando só o obrigatório é informado', () => {
    const env = loadEnv({ ...MINIMO });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_APP_ROLE).toBe('ecojotaduo_app');
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.JWT_ISSUER).toBe('ecojotaduo-platform');
  });

  it('falha cedo listando TODAS as variáveis faltantes', () => {
    try {
      loadEnv({});
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(InvalidEnvError);
      expect((erro as Error).message).toContain('DATABASE_URL');
      expect((erro as Error).message).toContain('JWT_SECRET');
      expect((erro as Error).message).toContain('SECRETS_KEY');
    }
  });

  it('recusa segredo de assinatura fraco', () => {
    expect(() => loadEnv({ ...MINIMO, JWT_SECRET: 'curto-demais' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('converte PORT de string para número', () => {
    expect(loadEnv({ ...MINIMO, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejeita PORT não numérica ou fora da faixa', () => {
    expect(() => loadEnv({ ...MINIMO, PORT: 'abc' })).toThrow(InvalidEnvError);
    expect(() => loadEnv({ ...MINIMO, PORT: '70000' })).toThrow(
      InvalidEnvError,
    );
  });

  it('rejeita DATABASE_URL malformada', () => {
    expect(() => loadEnv({ ...MINIMO, DATABASE_URL: 'nao-e-uma-url' })).toThrow(
      InvalidEnvError,
    );
  });

  it('recusa TTL de access token fora dos limites de segurança', () => {
    expect(() =>
      loadEnv({ ...MINIMO, ACCESS_TOKEN_TTL_SECONDS: '86400' }),
    ).toThrow(InvalidEnvError);
  });

  it('recusa chave de segredos com tamanho errado em vez de esticá-la', () => {
    // Aceitar chave curta daria cifra fraca sem nenhum sinal em runtime.
    expect(() =>
      loadEnv({ ...MINIMO, SECRETS_KEY: randomBytes(16).toString('base64') }),
    ).toThrow(/SECRETS_KEY/);
  });

  it('aceita ambiente completo válido', () => {
    const env = loadEnv({
      ...MINIMO,
      NODE_ENV: 'production',
      DATABASE_ADMIN_URL: 'postgresql://owner:pwd@localhost:5432/ecojotaduo',
      REDIS_URL: 'redis://localhost:6379',
      REFRESH_TOKEN_TTL_DAYS: '7',
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(env.DATABASE_ADMIN_URL).toContain('owner');
  });
});
