import type { Rental } from '../domain/rental';

export interface Pagina {
  readonly limit: number;
  readonly offset: number;
}

export interface Paginado<T> {
  readonly items: T[];
  readonly total: number;
}

export interface FiltroDeLocacoes extends Pagina {
  readonly contractId?: string;
  readonly customerId?: string;
  readonly assetId?: string;
  readonly status?: string;
  /** `true` traz só as em andamento com prazo vencido — filtrado no banco. */
  readonly atrasadas?: boolean;
}

export interface RentalRepository {
  save(tenantId: string, locacao: Rental): Promise<void>;
  findById(tenantId: string, rentalId: string): Promise<Rental | null>;
  search(tenantId: string, filtro: FiltroDeLocacoes): Promise<Paginado<Rental>>;
  /** Reserva o próximo número da empresa, de forma atômica. */
  reservarNumero(tenantId: string): Promise<number>;
}
