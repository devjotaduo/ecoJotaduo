import { z } from 'zod';

/** Schemas de borda de Operações, compartilhados por REST e MCP. */

export const programarSchema = z.object({
  /** Contrato EM VIGOR que cobre a locação. O cliente vem dele. */
  contractId: z.uuid(),
  assetId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  notes: z.string().max(5000).nullish(),
});

export const encerrarSchema = z.object({
  reason: z.string().max(2000).nullish(),
});

export const pesquisarLocacoesSchema = z.object({
  contractId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  status: z.enum(['scheduled', 'active', 'finished', 'canceled']).optional(),
  /** Só as em andamento com prazo vencido. */
  atrasadas: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
