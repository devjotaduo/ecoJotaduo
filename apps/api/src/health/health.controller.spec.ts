import type { DatabaseHandle } from '@movimentar/database';
import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

function handleFake(responde: boolean): DatabaseHandle {
  return {
    db: {} as DatabaseHandle['db'],
    sql: (() =>
      responde
        ? Promise.resolve([{ '?column?': 1 }])
        : Promise.reject(
            new Error('conexão recusada'),
          )) as unknown as DatabaseHandle['sql'],
    close: () => Promise.resolve(),
  };
}

describe('HealthController', () => {
  it('liveness responde ok com uptime e timestamp UTC válido', () => {
    const resultado = new HealthController(handleFake(true)).check();

    expect(resultado.status).toBe('ok');
    expect(resultado.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(resultado.timestamp))).toBe(false);
    expect(resultado.timestamp.endsWith('Z')).toBe(true);
  });

  it('readiness confirma o banco quando ele responde', async () => {
    await expect(
      new HealthController(handleFake(true)).ready(),
    ).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok' },
    });
  });

  it('readiness devolve 503 quando o banco está fora', async () => {
    await expect(
      new HealthController(handleFake(false)).ready(),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
