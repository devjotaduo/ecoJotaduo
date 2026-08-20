import type { DatabaseHandle } from '@ecojotaduo/database';
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';

import { DATABASE } from '../bootstrap/tokens';
import { Public } from '../http/decorators';

export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessStatus {
  status: 'ready';
  checks: { database: 'ok' };
}

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  /** Liveness: o processo está de pé. Não toca em dependências externas. */
  @Public()
  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: só responde OK se o banco atender. É isto que o balanceador
   * consulta antes de mandar tráfego para uma réplica nova.
   */
  @Public()
  @Get('ready')
  async ready(): Promise<ReadinessStatus> {
    try {
      await this.database.sql`select 1`;
    } catch (causa) {
      throw new ServiceUnavailableException('Banco de dados indisponível.', {
        cause: causa,
      });
    }
    return { status: 'ready', checks: { database: 'ok' } };
  }
}
