import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carrega o `.env.test` da raiz do monorepo em `process.env`.
 *
 * O Vitest não lê arquivos .env para dentro do `process.env`, então usamos
 * `process.loadEnvFile` (nativo do Node ≥ 20.12) em um setupFile. Todos os
 * pacotes ficam dois níveis abaixo da raiz (packages/x, modules/x, apps/x).
 */
const arquivo = resolve(process.cwd(), '..', '..', '.env.test');

if (existsSync(arquivo)) {
  process.loadEnvFile(arquivo);
}
