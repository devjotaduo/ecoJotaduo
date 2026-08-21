/**
 * Superfície pública do módulo Ativos.
 *
 * É o ÚNICO ponto de entrada para outros módulos (Operações e Manutenção, nas
 * próximas fases). Ninguém de fora importa `src/**` nem toca nas tabelas
 * `assets_*`.
 */

export interface AssetSummary {
  readonly assetId: string;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  /** Situação de LEITURA no instante da consulta — derivada dos bloqueios. */
  readonly availability: 'available' | 'held' | 'retired';
}

export interface AssetAvailabilityAnswer {
  readonly assetId: string;
  readonly code: string;
  readonly available: boolean;
  /** Quando ocupado, até quando o compromisso mais próximo segura o ativo. */
  readonly heldUntil: Date | null;
}

export interface AssetsPublicApi {
  /**
   * Devolve `null` quando o ativo não existe NESTA empresa — não lança.
   * Quem chama decide se ausência é erro no contexto dele.
   */
  findAsset(tenantId: string, assetId: string): Promise<AssetSummary | null>;

  /**
   * O equipamento está livre no período? `null` quando ele não existe aqui.
   *
   * É a pergunta que Operações precisa fazer antes de prometer a máquina a um
   * cliente — e a razão de este módulo existir antes daquele.
   */
  checkAvailability(
    tenantId: string,
    assetId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<AssetAvailabilityAnswer | null>;

  /**
   * Tira o equipamento de circulação num período, em nome de outro módulo.
   *
   * Quem chama descreve o COMPROMISSO (uma locação, uma ordem de serviço); o
   * bloqueio em si continua sendo assunto de Ativos, com as regras dele:
   * equipamento baixado recusa, período já comprometido recusa, e a restrição
   * de exclusão do banco fecha a corrida. Lança erro de domínio de Ativos —
   * quem chama deixa subir, e o filtro traduz para o status certo.
   */
  reserve(
    tenantId: string,
    entrada: {
      assetId: string;
      startsAt: Date;
      endsAt: Date;
      notes?: string | null;
    },
  ): Promise<AssetReservation>;

  /** Devolve o equipamento à circulação agora, encerrando a reserva. */
  releaseReservation(tenantId: string, holdId: string): Promise<void>;
}

export interface AssetReservation {
  readonly holdId: string;
  readonly assetId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export const ASSETS_PUBLIC_API = Symbol.for('ecojotaduo.assets.publicApi');
