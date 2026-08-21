import { z } from 'zod';

/**
 * Schemas das respostas de autenticação — contrato publicado e tipo do SDK.
 * O teste de contrato confere que as rotas devolvem exatamente isto.
 */

export const empresaResposta = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
});

/**
 * O refresh token NÃO aparece aqui: ele volta num cookie `httpOnly`, fora do
 * alcance de qualquer script (ver `refresh-cookie.ts`). O que sobra é a data
 * de expiração, que a tela usa para saber quando a sessão morre sem precisar
 * do segredo em si.
 */
export const sessaoResposta = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshTokenExpiresAt: z.iso.datetime(),
  tenant: empresaResposta,
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  permissions: z.array(z.string()),
  entitlements: z.array(z.string()),
});

export const sessaoRenovadaResposta = sessaoResposta.omit({
  tenant: true,
  user: true,
});

export const tokenDeServicoResposta = z.object({
  accessToken: z.string(),
  expiresAt: z.iso.datetime(),
  tokenType: z.literal('Bearer'),
  scopes: z.array(z.string()),
});

export const meResposta = z.object({
  tenantId: z.uuid(),
  actor: z.object({
    kind: z.enum(['user', 'service', 'system']),
    id: z.string(),
    label: z.string().optional(),
  }),
  permissions: z.array(z.string()),
  scopes: z.array(z.string()),
  entitlements: z.array(z.string()),
});

export const minhasEmpresasResposta = z.object({
  items: z.array(
    z.object({ tenantId: z.uuid(), slug: z.string(), name: z.string() }),
  ),
});

export const entitlementResposta = z.object({
  moduleId: z.string(),
  status: z.enum(['active', 'suspended']),
  expiresAt: z.iso.datetime().nullable(),
});

export const entitlementsResposta = z.object({
  items: z.array(entitlementResposta),
});

export const eventoDeAuditoriaResposta = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  actorKind: z.string(),
  actorId: z.string(),
  channel: z.string(),
  action: z.string(),
  result: z.enum(['success', 'denied', 'error']),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  durationMs: z.number().int().optional(),
  correlationId: z.uuid(),
  occurredAt: z.iso.datetime(),
});

export const auditoriaPaginadaResposta = z.object({
  items: z.array(eventoDeAuditoriaResposta),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
