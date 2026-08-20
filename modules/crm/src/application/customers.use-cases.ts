import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';

import { Customer } from '../domain/customer';
import { CustomerDocument } from '../domain/document';
import {
  CustomerNotFoundError,
  DuplicateCustomerDocumentError,
} from '../domain/errors';
import type {
  AppointmentRepository,
  CustomerNoteRepository,
  CustomerRepository,
  Pagina,
  Paginado,
} from '../ports/repositories';
import type { Appointment } from '../domain/appointment';
import type { CustomerNote } from '../domain/note';

export interface CriarClienteEntrada {
  readonly tenantId: string;
  readonly name: string;
  readonly document?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export class CreateCustomerUseCase {
  constructor(
    private readonly clientes: CustomerRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: CriarClienteEntrada): Promise<Customer> {
    // Unicidade do documento por empresa: dois cadastros do mesmo CNPJ viram
    // histórico dividido, que é o problema clássico de CRM sujo.
    if (entrada.document) {
      const documento = CustomerDocument.create(entrada.document);
      const existente = await this.clientes.findByDocument(
        entrada.tenantId,
        documento.digits,
      );
      if (existente) {
        throw new DuplicateCustomerDocumentError(documento.format());
      }
    }

    const cliente = Customer.create({ id: randomUUID(), ...entrada });
    await this.clientes.save(entrada.tenantId, cliente);

    await this.audit.record({
      action: 'crm.customer.created',
      result: 'success',
      resourceType: 'customer',
      resourceId: cliente.id,
      metadata: { name: cliente.name },
    });

    return cliente;
  }
}

export class UpdateCustomerUseCase {
  constructor(
    private readonly clientes: CustomerRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    customerId: string;
    name?: string;
    document?: string | null;
    email?: string | null;
    phone?: string | null;
  }): Promise<Customer> {
    const cliente = await this.clientes.findById(
      entrada.tenantId,
      entrada.customerId,
    );
    if (!cliente) {
      throw new CustomerNotFoundError(entrada.customerId);
    }

    if (entrada.document) {
      const documento = CustomerDocument.create(entrada.document);
      const dono = await this.clientes.findByDocument(
        entrada.tenantId,
        documento.digits,
      );
      if (dono && dono.id !== cliente.id) {
        throw new DuplicateCustomerDocumentError(documento.format());
      }
    }

    cliente.update({
      name: entrada.name,
      document: entrada.document,
      email: entrada.email,
      phone: entrada.phone,
    });
    await this.clientes.save(entrada.tenantId, cliente);

    await this.audit.record({
      action: 'crm.customer.updated',
      result: 'success',
      resourceType: 'customer',
      resourceId: cliente.id,
    });

    return cliente;
  }
}

export class SearchCustomersUseCase {
  constructor(private readonly clientes: CustomerRepository) {}

  execute(
    entrada: {
      tenantId: string;
      termo?: string;
      apenasAtivos?: boolean;
    } & Pagina,
  ): Promise<Paginado<Customer>> {
    return this.clientes.search(entrada.tenantId, entrada);
  }
}

export interface ItemDoHistorico {
  readonly kind: 'note' | 'appointment';
  readonly id: string;
  readonly occurredAt: Date;
  readonly summary: string;
  readonly detail?: string | null;
  readonly status?: string;
}

export interface ClienteComHistorico {
  readonly customer: Customer;
  readonly timeline: ItemDoHistorico[];
}

/**
 * Cliente com sua linha do tempo (notas + agendamentos, do mais recente ao mais
 * antigo). É a tela de "histórico do cliente" em uma única chamada — evita o
 * cliente da API ter que juntar três listas e ordenar por conta própria.
 */
export class GetCustomerUseCase {
  constructor(
    private readonly clientes: CustomerRepository,
    private readonly notas: CustomerNoteRepository,
    private readonly agendamentos: AppointmentRepository,
  ) {}

  async execute(entrada: {
    tenantId: string;
    customerId: string;
    historicoLimite?: number;
  }): Promise<ClienteComHistorico> {
    const cliente = await this.clientes.findById(
      entrada.tenantId,
      entrada.customerId,
    );
    if (!cliente) {
      throw new CustomerNotFoundError(entrada.customerId);
    }

    const limite = Math.min(Math.max(entrada.historicoLimite ?? 20, 1), 100);
    const pagina = { limit: limite, offset: 0 };

    const [notas, agendamentos] = await Promise.all([
      this.notas.listByCustomer(entrada.tenantId, cliente.id, pagina),
      this.agendamentos.listByCustomer(entrada.tenantId, cliente.id, pagina),
    ]);

    const timeline = [
      ...notas.items.map(paraItemDeNota),
      ...agendamentos.items.map(paraItemDeAgendamento),
    ]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limite);

    return { customer: cliente, timeline };
  }
}

function paraItemDeNota(nota: CustomerNote): ItemDoHistorico {
  return {
    kind: 'note',
    id: nota.id,
    occurredAt: nota.createdAt,
    summary:
      nota.body.length > 120 ? `${nota.body.slice(0, 117)}...` : nota.body,
    detail: nota.body,
  };
}

function paraItemDeAgendamento(agendamento: Appointment): ItemDoHistorico {
  return {
    kind: 'appointment',
    id: agendamento.id,
    // A linha do tempo usa a data do compromisso, não a de criação: é ela que
    // o usuário procura ao perguntar "quando estivemos com esse cliente?".
    occurredAt: agendamento.scheduledFor,
    summary: agendamento.title,
    detail: agendamento.outcome,
    status: agendamento.status,
  };
}
