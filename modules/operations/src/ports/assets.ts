/**
 * O que Operações precisa do patrimônio.
 *
 * Reservar é escrita em OUTRO módulo: Operações descreve o compromisso, e
 * Ativos aplica as regras dele (equipamento baixado recusa, período já
 * comprometido recusa, restrição de exclusão fecha a corrida). Este módulo
 * nunca toca nas tabelas `assets_*`.
 */
export interface EquipamentoLocavel {
  readonly assetId: string;
  readonly code: string;
  readonly name: string;
  /** Situação de leitura no patrimônio — `retired` não sai para locação. */
  readonly availability: string;
}

export interface ReservaDeEquipamento {
  readonly holdId: string;
}

export interface AssetDirectory {
  /** `null` quando o equipamento não existe NESTA empresa. */
  find(tenantId: string, assetId: string): Promise<EquipamentoLocavel | null>;

  /** Tira o equipamento de circulação no período. Lança se já comprometido. */
  reservar(
    tenantId: string,
    entrada: {
      assetId: string;
      startsAt: Date;
      endsAt: Date;
      notes?: string | null;
    },
  ): Promise<ReservaDeEquipamento>;

  /** Devolve o equipamento à circulação agora. */
  liberar(tenantId: string, holdId: string): Promise<void>;
}
