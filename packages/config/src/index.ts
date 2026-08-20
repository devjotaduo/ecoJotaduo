import { z } from 'zod';

/**
 * Schema único das variáveis de ambiente da plataforma.
 *
 * Todo app (api, mcp-gateway, worker) valida o ambiente no boot e falha cedo
 * com mensagem clara — nunca inicia meio-configurado.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Tornam-se obrigatórias na Fase 2, quando a persistência entra.
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  constructor(issues: readonly string[]) {
    super(
      `Variáveis de ambiente inválidas:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'InvalidEnvError';
  }
}

/** Valida e retorna o ambiente. Lança InvalidEnvError com todas as violações. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
      ),
    );
  }
  return result.data;
}
