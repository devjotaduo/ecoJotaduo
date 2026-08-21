import { z } from 'zod';

/** Schemas de borda de Contratos, compartilhados por REST e MCP. */

export const formalizarSchema = z.object({
  /** A proposta ACEITA que vira contrato. Valor e cliente vêm dela. */
  proposalId: z.uuid(),
  startsOn: z.iso.datetime(),
  endsOn: z.iso.datetime(),
  notes: z.string().max(5000).nullish(),
});

export const encerrarSchema = z.object({
  reason: z.string().max(2000).nullish(),
});

export const pesquisarContratosSchema = z.object({
  customerId: z.uuid().optional(),
  status: z.enum(['draft', 'active', 'finished', 'canceled']).optional(),
  termo: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
