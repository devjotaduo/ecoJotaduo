import type { Asset } from '../domain/asset';
import type { AssetHold } from '../domain/hold';
import type { Periodo } from '../domain/periodo';

export interface Pagina {
  readonly limit: number;
  readonly offset: number;
}

export interface Paginado<T> {
  readonly items: T[];
  readonly total: number;
}

export interface FiltroDeAtivos extends Pagina {
  readonly category?: string;
  /** Situação de LEITURA — `available`/`held` saem dos bloqueios, não de coluna. */
  readonly availability?: 'available' | 'held' | 'retired';
  readonly termo?: string;
  /** Instante de referência da disponibilidade. Padrão: agora. */
  readonly em?: Date;
}

export interface AssetRepository {
  save(tenantId: string, ativo: Asset): Promise<void>;
  findById(tenantId: string, assetId: string): Promise<Asset | null>;
  /** O código é a identificação de patrimônio: única na empresa. */
  findByCode(tenantId: string, code: string): Promise<Asset | null>;
  search(tenantId: string, filtro: FiltroDeAtivos): Promise<Paginado<Asset>>;
}

export interface AssetHoldRepository {
  save(tenantId: string, bloqueio: AssetHold): Promise<void>;
  findById(tenantId: string, holdId: string): Promise<AssetHold | null>;
  /**
   * Bloqueios do ativo cujo período EFETIVO cruza o intervalo pedido.
   * É a consulta que sustenta "este equipamento está livre nessa semana?".
   */
  findOverlapping(
    tenantId: string,
    assetId: string,
    periodo: Periodo,
  ): Promise<AssetHold[]>;
  /** Histórico do ativo, do mais recente para o mais antigo. */
  listByAsset(
    tenantId: string,
    assetId: string,
    limite: number,
  ): Promise<AssetHold[]>;
  /**
   * Bloqueios vigentes num instante, para VÁRIOS ativos de uma vez — a
   * listagem precisa da situação de cada linha sem uma consulta por linha.
   */
  findActiveForAssets(
    tenantId: string,
    assetIds: readonly string[],
    instante: Date,
  ): Promise<AssetHold[]>;
}
