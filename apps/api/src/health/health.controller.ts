import { Controller, Get } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

/**
 * Liveness básico do processo. A partir da Fase 2 ganha um /readiness que
 * verifica PostgreSQL e Redis antes de receber tráfego.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
