import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';

import { CustomerNotFoundError } from '../domain/errors';
import { CustomerNote } from '../domain/note';
import type {
  CustomerNoteRepository,
  CustomerRepository,
  Pagina,
  Paginado,
} from '../ports/repositories';

export class AddCustomerNoteUseCase {
  constructor(
    private readonly clientes: CustomerRepository,
    private readonly notas: CustomerNoteRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    customerId: string;
    body: string;
    authorId: string;
  }): Promise<CustomerNote> {
    const cliente = await this.clientes.findById(
      entrada.tenantId,
      entrada.customerId,
    );
    if (!cliente) {
      throw new CustomerNotFoundError(entrada.customerId);
    }
    cliente.assertAceitaInteracao();

    const nota = CustomerNote.create({
      id: randomUUID(),
      customerId: cliente.id,
      body: entrada.body,
      authorId: entrada.authorId,
    });
    await this.notas.add(entrada.tenantId, nota);

    await this.audit.record({
      action: 'crm.note.added',
      result: 'success',
      resourceType: 'customer',
      resourceId: cliente.id,
      // Só o tamanho: o conteúdo da nota pode ter dado sensível do cliente.
      metadata: { noteId: nota.id, length: nota.body.length },
    });

    return nota;
  }
}

export class ListCustomerNotesUseCase {
  constructor(
    private readonly clientes: CustomerRepository,
    private readonly notas: CustomerNoteRepository,
  ) {}

  async execute(
    entrada: { tenantId: string; customerId: string } & Pagina,
  ): Promise<Paginado<CustomerNote>> {
    const cliente = await this.clientes.findById(
      entrada.tenantId,
      entrada.customerId,
    );
    if (!cliente) {
      throw new CustomerNotFoundError(entrada.customerId);
    }

    return this.notas.listByCustomer(entrada.tenantId, cliente.id, {
      limit: Math.min(Math.max(entrada.limit, 1), 100),
      offset: Math.max(entrada.offset, 0),
    });
  }
}
