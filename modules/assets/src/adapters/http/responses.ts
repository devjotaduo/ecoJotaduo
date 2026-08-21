import { paginado } from '@ecojotaduo/http-kit';
import { z } from 'zod';

import { MOTIVOS_DE_BLOQUEIO } from '../../domain/hold';

/** Schemas de RESPOSTA — o que o contrato OpenAPI publica. */

export const bloqueioResposta = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  reason: z.enum(MOTIVOS_DE_BLOQUEIO),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  releasedAt: z.iso.datetime().nullable(),
  effectiveEndsAt: z.iso.datetime(),
  open: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const ativoResposta = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  category: z.string(),
  serialNumber: z.string().nullable(),
  acquiredOn: z.iso.datetime().nullable(),
  status: z.enum(['active', 'retired']),
  availability: z.enum(['available', 'held', 'retired']),
  currentHold: bloqueioResposta.nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  retiredAt: z.iso.datetime().nullable(),
  retireReason: z.string().nullable(),
});

export const ativoComHistoricoResposta = ativoResposta.extend({
  history: z.array(bloqueioResposta),
});

export const disponibilidadeResposta = z.object({
  assetId: z.uuid(),
  code: z.string(),
  available: z.boolean(),
  conflicts: z.array(bloqueioResposta),
});

export const ativosPaginados = paginado(ativoResposta);
