import { describe, expect, it } from 'vitest';

import { InvalidEnvError, loadEnv } from './index';

describe('loadEnv', () => {
  it('aplica defaults em ambiente vazio', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('converte PORT de string para número', () => {
    expect(loadEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejeita PORT não numérica com erro descritivo', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(InvalidEnvError);
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejeita PORT fora da faixa válida', () => {
    expect(() => loadEnv({ PORT: '70000' })).toThrow(InvalidEnvError);
  });

  it('rejeita DATABASE_URL malformada', () => {
    expect(() => loadEnv({ DATABASE_URL: 'nao-e-uma-url' })).toThrow(
      InvalidEnvError,
    );
  });

  it('aceita ambiente completo válido', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.DATABASE_URL).toContain('postgresql://');
  });
});
