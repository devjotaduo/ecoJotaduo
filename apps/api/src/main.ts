import 'reflect-metadata';

import { loadEnv } from '@ecojotaduo/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './http/problem-details.filter';
import { registrarLimiteDeRequisicoes } from './http/rate-limit';
import { registrarContextoDeRequisicao } from './http/request-context';

export async function bootstrap(): Promise<NestFastifyApplication> {
  // Fail-fast: ambiente inválido derruba o boot com mensagem clara.
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  registrarContextoDeRequisicao(app.getHttpAdapter().getInstance());
  await registrarLimiteDeRequisicoes(app, env);
  app.useGlobalFilters(new ProblemDetailsFilter());
  // Dispara o OnApplicationShutdown de DatabaseLifecycle em SIGTERM/SIGINT.
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  new Logger('bootstrap').log(
    `API ouvindo na porta ${env.PORT} (${env.NODE_ENV}).`,
  );

  return app;
}

// Só sobe o servidor quando este arquivo é o ponto de entrada: importar o
// módulo (em teste ou ferramenta) não pode ter efeito colateral.
if (require.main === module) {
  void bootstrap();
}
