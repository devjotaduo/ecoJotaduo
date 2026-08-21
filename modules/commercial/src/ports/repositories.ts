import type { Proposal } from '../domain/proposal';

export interface Pagina {
  readonly limit: number;
  readonly offset: number;
}

export interface Paginado<T> {
  readonly items: T[];
  readonly total: number;
}

export interface FiltroDePropostas extends Pagina {
  readonly customerId?: string;
  readonly status?: string;
  readonly termo?: string;
}

export interface ProposalRepository {
  /** Insere ou atualiza cabeçalho e itens como um bloco só. */
  save(tenantId: string, proposta: Proposal): Promise<void>;
  findById(tenantId: string, proposalId: string): Promise<Proposal | null>;
  search(
    tenantId: string,
    filtro: FiltroDePropostas,
  ): Promise<Paginado<Proposal>>;
  /**
   * Reserva o próximo número da empresa, de forma atômica.
   *
   * Fica na porta (e não num `max()+1` no caso de uso) porque a garantia é do
   * banco: duas criações simultâneas precisam receber números diferentes.
   */
  reservarNumero(tenantId: string): Promise<number>;
}
