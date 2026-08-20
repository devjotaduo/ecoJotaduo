import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('responde ok com uptime e timestamp UTC válido', () => {
    const resultado = new HealthController().check();

    expect(resultado.status).toBe('ok');
    expect(resultado.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(resultado.timestamp))).toBe(false);
    expect(resultado.timestamp.endsWith('Z')).toBe(true);
  });
});
