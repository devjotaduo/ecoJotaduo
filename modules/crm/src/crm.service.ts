import type { CrmCustomerSummary, CrmPublicApi } from './contracts/public-api';
import type { CustomerRepository } from './ports/repositories';

/** Implementação da superfície pública do CRM. */
export class CrmService implements CrmPublicApi {
  constructor(private readonly clientes: CustomerRepository) {}

  async findCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<CrmCustomerSummary | null> {
    const cliente = await this.clientes.findById(tenantId, customerId);
    return cliente
      ? {
          customerId: cliente.id,
          name: cliente.name,
          status: cliente.status,
        }
      : null;
  }
}
