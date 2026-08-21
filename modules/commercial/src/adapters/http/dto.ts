import { z } from 'zod';

/** Schemas de borda do Comercial, compartilhados por REST e MCP. */

export const itemSchema = z.object({
  description: z.string().min(2).max(300),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  /** Centavos, sempre inteiro — nunca um valor com vírgula. */
  unitPriceCents: z.coerce.number().int().min(0),
  discountCents: z.coerce.number().int().min(0).optional(),
});

export const criarPropostaSchema = z.object({
  customerId: z.uuid(),
  title: z.string().min(2).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/, 'código ISO 4217, ex.: BRL'),
  validUntil: z.iso.datetime(),
  notes: z.string().max(5000).nullish(),
  items: z.array(itemSchema).max(200).optional(),
});

export const atualizarPropostaSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  notes: z.string().max(5000).nullish(),
  validUntil: z.iso.datetime().optional(),
  items: z.array(itemSchema).max(200).optional(),
});

export const pesquisarPropostasSchema = z.object({
  customerId: z.uuid().optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected']).optional(),
  termo: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
