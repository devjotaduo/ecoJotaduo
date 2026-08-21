/**
 * Superfície pública do módulo Comercial.
 *
 * É o ÚNICO ponto de entrada para outros módulos (hoje, contracts). Ninguém de
 * fora importa `src/**` nem toca nas tabelas `commercial_*`.
 */

export interface CommercialProposalSummary {
  readonly proposalId: string;
  readonly number: number;
  readonly customerId: string;
  readonly title: string;
  readonly currency: string;
  readonly totalCents: number;
  /** Situação de LEITURA: inclui `expired`, derivado da validade. */
  readonly status: string;
}

export interface CommercialPublicApi {
  /**
   * Devolve `null` quando a proposta não existe nesta empresa — não lança.
   * Quem chama decide se ausência é erro no contexto dele.
   */
  findProposal(
    tenantId: string,
    proposalId: string,
  ): Promise<CommercialProposalSummary | null>;
}

export const COMMERCIAL_PUBLIC_API = Symbol.for(
  'ecojotaduo.commercial.publicApi',
);
