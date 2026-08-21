import { z } from 'zod';

/** Schemas de borda do registry de plugins. */

export const instalarSchema = z.object({
  /**
   * Subconjunto do que o manifesto pede. Vazio é legítimo: um plugin que só
   * fala com o mundo externo não precisa de acesso a nada da plataforma.
   */
  grantedPermissions: z.array(z.string().min(1).max(120)).max(50).default([]),
});

export const configurarSchema = z.object({
  config: z.record(z.string(), z.unknown()).default({}),
  /**
   * Valores em claro na REQUISIÇÃO (única vez que trafegam) — são cifrados
   * antes de tocar o banco e nunca voltam em nenhuma resposta.
   */
  secrets: z
    .record(z.string().min(1).max(60), z.string().min(1).max(4096))
    .optional(),
});
