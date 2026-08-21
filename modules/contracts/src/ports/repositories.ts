import type { Contract } from '../domain/contract';

export interface Pagina {
  readonly limit: number;
  readonly offset: number;
}

export interface Paginado<T> {
  readonly items: T[];
  readonly total: number;
}

export interface FiltroDeContratos extends Pagina {
  readonly customerId?: string;
  readonly status?: string;
  readonly termo?: string;
}

export interface ContractRepository {
  save(tenantId: string, contrato: Contract): Promise<void>;
  findById(tenantId: string, contractId: string): Promise<Contract | null>;
  /** Usado para garantir que uma proposta vire UM contrato só. */
  findByProposal(
    tenantId: string,
    proposalId: string,
  ): Promise<Contract | null>;
  search(
    tenantId: string,
    filtro: FiltroDeContratos,
  ): Promise<Paginado<Contract>>;
  /** Reserva o próximo número da empresa, de forma atômica. */
  reservarNumero(tenantId: string): Promise<number>;
}
