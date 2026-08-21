/**
 * O que Contratos precisa saber sobre uma proposta.
 *
 * Porta própria, com as palavras deste módulo. Quem liga isto ao Comercial é o
 * composition root — assim Contratos é testável sozinho, e a regra "só de
 * proposta aceita" fica AQUI, onde ela é do negócio de contratos.
 */
export interface PropostaAceitavel {
  readonly proposalId: string;
  readonly number: number;
  readonly customerId: string;
  readonly title: string;
  readonly currency: string;
  readonly totalCents: number;
  /** Situação de leitura (inclui `expired`). */
  readonly status: string;
}

export interface ProposalDirectory {
  /** `null` quando a proposta não existe NESTA empresa. */
  find(tenantId: string, proposalId: string): Promise<PropostaAceitavel | null>;
}
