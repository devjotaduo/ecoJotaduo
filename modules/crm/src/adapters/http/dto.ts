import { z } from 'zod';

/** Schemas de borda do CRM, compartilhados por REST e MCP. */

export const criarClienteSchema = z.object({
  name: z.string().min(2).max(200),
  document: z.string().min(11).max(20).nullish(),
  email: z.email().max(254).nullish(),
  phone: z.string().max(30).nullish(),
});

export const atualizarClienteSchema = criarClienteSchema.partial();

export const pesquisarClientesSchema = z.object({
  termo: z.string().max(120).optional(),
  apenasAtivos: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adicionarNotaSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const agendarSchema = z.object({
  customerId: z.uuid(),
  title: z.string().min(1).max(200),
  scheduledFor: z.iso.datetime(),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  assignedToId: z.uuid().nullish(),
});

export const encerrarAgendamentoSchema = z.object({
  outcome: z.string().max(2000).nullish(),
});

export const agendaSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  assignedToId: z.uuid().optional(),
  status: z.enum(['scheduled', 'done', 'canceled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const paginaSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
