import type {
  CommercialProposalSummary,
  CommercialPublicApi,
} from './contracts/public-api';
import type { ProposalRepository } from './ports/repositories';

/** Implementação da superfície pública do Comercial. */
export class CommercialService implements CommercialPublicApi {
  constructor(private readonly propostas: ProposalRepository) {}

  async findProposal(
    tenantId: string,
    proposalId: string,
  ): Promise<CommercialProposalSummary | null> {
    const proposta = await this.propostas.findById(tenantId, proposalId);
    if (!proposta) {
      return null;
    }
    return {
      proposalId: proposta.id,
      number: proposta.number,
      customerId: proposta.customerId,
      title: proposta.title,
      currency: proposta.currency,
      totalCents: proposta.total.cents,
      // `situacao()` e não `status`: quem consome precisa enxergar a proposta
      // vencida como vencida, e não como "enviada".
      status: proposta.situacao(),
    };
  }
}
