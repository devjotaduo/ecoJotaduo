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
  /** Porta do gateway MCP: outro processo, outra porta, mesmo `.env`. */
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  /** Conexão da aplicação: papel SEM privilégio de dono, para a RLS valer. */
  DATABASE_URL: z.url(),
  /** Conexão do dono das tabelas; usada apenas pelo comando de migração. */
  DATABASE_ADMIN_URL: z.url().optional(),
  DATABASE_APP_ROLE: z.string().min(1).default('ecojotaduo_app'),

  /** Segredo de assinatura dos access tokens (mínimo 32 bytes). */
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ISSUER: z.string().min(1).default('ecojotaduo-platform'),
  JWT_AUDIENCE: z.string().min(1).default('ecojotaduo-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /**
   * Chave que cifra os segredos de integração guardados por empresa (AES-256).
   * 32 bytes em base64 — gere com `openssl rand -base64 32`.
   *
   * Obrigatória, e não opcional com fallback: uma plataforma que aceita subir
   * sem chave acaba guardando token de terceiro em claro sem ninguém notar.
   */
  SECRETS_KEY: z
    .string()
    .refine(
      (valor) => Buffer.from(valor, 'base64').length === 32,
      'precisa ser 32 bytes em base64 (openssl rand -base64 32)',
    ),

  /**
   * Rate limiting (Fase 10). O limite é POR INSTÂNCIA: o contador vive na
   * memória do processo, porque a plataforma deliberadamente não tem Redis
   * (ADR-0012). Com N réplicas o teto efetivo é N vezes maior — o que ainda
   * contém força bruta e laço de agente, e a troca por um store compartilhado
   * é configuração, não reescrita.
   */
  RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3600)
    .default(60),
  /** Teto geral por origem nas rotas autenticadas. */
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  /**
   * Teto do login, bem mais apertado: é a única rota pública que valida
   * segredo, e o custo do scrypt sozinho não contém uma botnet paciente.
   */
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(10),
  /** Teto por credencial no gateway MCP: um agente em laço custa banco. */
  RATE_LIMIT_MCP_MAX: z.coerce.number().int().min(1).default(120),

  /** Reservado para BullMQ (Fase 8). */
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
