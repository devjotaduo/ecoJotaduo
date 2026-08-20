import 'reflect-metadata';

import { loadEnv } from '@movimentar/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Fail-fast: ambiente inválido derruba o boot com mensagem clara.
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // Necessário para drenar conexões em deploys sem downtime.
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
