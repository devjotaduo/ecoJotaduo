import { paginado } from '@ecojotaduo/http-kit';
import { z } from 'zod';

/** Schemas de RESPOSTA — o que o contrato OpenAPI publica. */
export const locacaoResposta = z.object({
  id: z.uuid(),
  number: z.number().int(),
  contractId: z.uuid(),
  customerId: z.uuid(),
  assetId: z.uuid(),
  assetCode: z.string(),
  holdId: z.uuid(),
  status: z.enum(['scheduled', 'active', 'finished', 'canceled', 'overdue']),
  storedStatus: z.enum(['scheduled', 'active', 'finished', 'canceled']),
  overdueDays: z.number().int(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  closeReason: z.string().nullable(),
});

export const locacoesPaginadas = paginado(locacaoResposta);
