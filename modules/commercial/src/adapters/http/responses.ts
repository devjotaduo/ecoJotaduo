import { paginado } from '@ecojotaduo/http-kit';
import { z } from 'zod';

/** Schemas de RESPOSTA — o que o contrato OpenAPI publica. */

export const itemResposta = z.object({
  id: z.uuid(),
  position: z.number().int(),
  description: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
});

export const propostaResposta = z.object({
  id: z.uuid(),
  number: z.number().int(),
  customerId: z.uuid(),
  customerName: z.string().nullable(),
  title: z.string(),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']),
  storedStatus: z.enum(['draft', 'sent', 'accepted', 'rejected']),
  currency: z.string(),
  totalCents: z.number().int(),
  notes: z.string().nullable(),
  validUntil: z.iso.datetime(),
  items: z.array(itemResposta),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});

export const propostasPaginadas = paginado(propostaResposta);
