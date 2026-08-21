import { paginado } from '@ecojotaduo/http-kit';
import { z } from 'zod';

/** Schemas de RESPOSTA — o que o contrato OpenAPI publica. */
export const contratoResposta = z.object({
  id: z.uuid(),
  number: z.number().int(),
  customerId: z.uuid(),
  proposalId: z.uuid(),
  title: z.string(),
  status: z.enum(['draft', 'active', 'finished', 'canceled', 'expired']),
  storedStatus: z.enum(['draft', 'active', 'finished', 'canceled']),
  inForce: z.boolean(),
  currency: z.string(),
  valueCents: z.number().int(),
  startsOn: z.iso.datetime(),
  endsOn: z.iso.datetime(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  closeReason: z.string().nullable(),
});

export const contratosPaginados = paginado(contratoResposta);
