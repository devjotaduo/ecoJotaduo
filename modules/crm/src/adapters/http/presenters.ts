import type { Appointment } from '../../domain/appointment';
import type { Customer } from '../../domain/customer';
import type { CustomerNote } from '../../domain/note';
import type { ItemDoHistorico } from '../../application/customers.use-cases';

/**
 * Conversão de domínio para JSON. Fica em um só lugar porque REST e MCP
 * devolvem exatamente a mesma forma — é isso que permite comparar as duas
 * bordas no teste de aceite da fase.
 */

export interface ClienteJson {
  id: string;
  name: string;
  document: string | null;
  documentFormatted: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function clienteJson(cliente: Customer): ClienteJson {
  return {
    id: cliente.id,
    name: cliente.name,
    document: cliente.document?.digits ?? null,
    documentFormatted: cliente.document?.format() ?? null,
    email: cliente.email,
    phone: cliente.phone,
    status: cliente.status,
    createdAt: cliente.createdAt.toISOString(),
    updatedAt: cliente.updatedAt.toISOString(),
  };
}

export function notaJson(nota: CustomerNote) {
  return {
    id: nota.id,
    customerId: nota.customerId,
    body: nota.body,
    authorId: nota.authorId,
    createdAt: nota.createdAt.toISOString(),
  };
}

export function agendamentoJson(agendamento: Appointment) {
  return {
    id: agendamento.id,
    customerId: agendamento.customerId,
    title: agendamento.title,
    scheduledFor: agendamento.scheduledFor.toISOString(),
    endsAt: agendamento.periodo.fim.toISOString(),
    durationMinutes: agendamento.durationMinutes,
    assignedToId: agendamento.assignedToId,
    status: agendamento.status,
    outcome: agendamento.outcome,
  };
}

export function historicoJson(item: ItemDoHistorico) {
  return {
    kind: item.kind,
    id: item.id,
    occurredAt: item.occurredAt.toISOString(),
    summary: item.summary,
    detail: item.detail ?? null,
    status: item.status ?? null,
  };
}
