import type {
  ContractsPublicApi,
  ContractSummary,
} from './contracts/public-api';
import type { ContractRepository } from './ports/repositories';

/** Implementação da superfície pública de Contratos. */
export class ContractsService implements ContractsPublicApi {
  constructor(private readonly contratos: ContractRepository) {}

  async findContract(
    tenantId: string,
    contractId: string,
  ): Promise<ContractSummary | null> {
    const contrato = await this.contratos.findById(tenantId, contractId);
    if (!contrato) {
      return null;
    }
    return {
      contractId: contrato.id,
      number: contrato.number,
      customerId: contrato.customerId,
      title: contrato.title,
      currency: contrato.currency,
      valueCents: contrato.valueCents,
      // `situacao()` e não `status`: quem consome precisa enxergar o contrato
      // com vigência vencida como vencido, e não como "ativo".
      status: contrato.situacao(),
      inForce: contrato.emVigor(),
      startsOn: contrato.startsOn,
      endsOn: contrato.endsOn,
    };
  }
}
