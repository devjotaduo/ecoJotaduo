import { paginado } from '@ecojotaduo/http-kit';
import { z } from 'zod';

/**
 * Schemas das RESPOSTAS do CRM.
 *
 * Existem por dois motivos: documentam o contrato publicado (viram OpenAPI) e
 * dão tipo de verdade ao SDK gerado. E, como são schemas de verdade, o teste
 * de contrato confere que os presenters produzem exatamente isto — se alguém
 * mudar um campo sem atualizar o contrato, o teste quebra.
 */

export const clienteResposta = z.object({
  id: z.uuid(),
  name: z.string(),
  document: z.string().nullable(),
  documentFormatted: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const itemDoHistoricoResposta = z.object({
  kind: z.enum(['note', 'appointment']),
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  summary: z.string(),
  detail: z.string().nullable(),
  status: z.string().nullable(),
});

export const clienteComHistoricoResposta = clienteResposta.extend({
  timeline: z.array(itemDoHistoricoResposta),
});

export const notaResposta = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  body: z.string(),
  authorId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const agendamentoResposta = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  title: z.string(),
  scheduledFor: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  durationMinutes: z.number().int(),
  assignedToId: z.uuid().nullable(),
  status: z.enum(['scheduled', 'done', 'canceled']),
  outcome: z.string().nullable(),
});

export const clientesPaginados = paginado(clienteResposta);
export const notasPaginadas = paginado(notaResposta);
export const agendamentosPaginados = paginado(agendamentoResposta);
