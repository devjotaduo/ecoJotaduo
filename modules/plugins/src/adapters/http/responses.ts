import { z } from 'zod';

/** Schemas de RESPOSTA — o que o contrato OpenAPI publica. */

export const instalacaoResposta = z.object({
  pluginId: z.string(),
  version: z.string(),
  status: z.enum(['installed', 'configured', 'enabled', 'disabled']),
  config: z.record(z.string(), z.unknown()),
  grantedPermissions: z.array(z.string()),
  installedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const saudeResposta = z.object({
  status: z.enum(['healthy', 'degraded', 'unavailable']),
  detail: z.string().nullable(),
});

export const pluginResposta = z.object({
  pluginId: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  publisher: z.string(),
  type: z.string(),
  requestedPermissions: z.array(z.string()),
  requiredSecrets: z.array(z.string()),
  installation: instalacaoResposta
    .extend({
      /** Apenas as chaves presentes; valores nunca saem do servidor. */
      configuredSecrets: z.array(z.string()),
      health: saudeResposta.nullable(),
    })
    .nullable(),
});

export const catalogoResposta = z.object({
  items: z.array(pluginResposta),
});
