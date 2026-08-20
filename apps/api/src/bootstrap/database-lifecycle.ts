import type { DatabaseHandle } from '@movimentar/database';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { DATABASE } from './tokens';

/**
 * Drena o pool de conexões no encerramento. Sem isto, um deploy sem downtime
 * derrubaria requisições em andamento junto com o processo.
 */
@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
