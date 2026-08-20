import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from '../app.module';
import { construirDocumentoOpenApi } from '../bootstrap/openapi';

/**
 * Gera `docs/api/openapi.json` sem subir servidor nem tocar o banco.
 *
 * O documento é versionado no repositório e o CI regenera e compara: se o
 * arquivo estiver desatualizado, o build falha. Assim o contrato publicado
 * nunca diverge do código — e a diferença aparece no diff do PR, onde dá para
 * revisar se a mudança quebra alguém.
 */
export async function emitirOpenApi(): Promise<string> {
  // O boot precisa das variáveis; o app nunca escuta nem consulta o banco.
  process.env.DATABASE_URL ??=
    'postgresql://openapi:openapi@127.0.0.1:5432/openapi';
  process.env.JWT_SECRET ??= 'x'.repeat(48);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();

  const documento = construirDocumentoOpenApi(app);
  await app.close();

  const destino = resolve(
    process.cwd(),
    '..',
    '..',
    'docs',
    'api',
    'openapi.json',
  );
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, `${JSON.stringify(documento, null, 2)}\n`, 'utf8');

  return destino;
}

if (require.main === module) {
  emitirOpenApi()
    .then((destino) => {
      console.log(`OpenAPI gerado em ${destino}`);
    })
    .catch((erro: unknown) => {
      console.error(erro instanceof Error ? erro.message : erro);
      process.exitCode = 1;
    });
}
