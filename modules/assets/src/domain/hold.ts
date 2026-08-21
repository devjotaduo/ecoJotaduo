import { HoldAlreadyReleasedError } from './errors';
import { Periodo } from './periodo';

/**
 * Bloqueio: o motivo pelo qual um ativo NÃO está disponível num período.
 *
 * A indisponibilidade não é uma coluna do ativo. Se fosse, seria um booleano
 * sem memória: não daria para dizer por que a máquina ficou parada, por quanto
 * tempo, nem responder "ela está livre semana que vem?" — que é exatamente a
 * pergunta que Operações vai fazer.
 */
export const MOTIVOS_DE_BLOQUEIO = [
  'maintenance',
  'reserved',
  'damaged',
  'transit',
] as const;

/** Derivado da tupla acima: acrescentar um motivo ali chega sozinho na borda. */
export type HoldReason = (typeof MOTIVOS_DE_BLOQUEIO)[number];

export interface DadosDoBloqueio {
  readonly id: string;
  readonly tenantId: string;
  readonly assetId: string;
  readonly reason: HoldReason;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Liberação antecipada. Encurta o período efetivo, não apaga o registro. */
  readonly releasedAt: Date | null;
  readonly notes: string | null;
  readonly createdAt: Date;
}

export class AssetHold {
  private constructor(private dados: DadosDoBloqueio) {}

  static restore(dados: DadosDoBloqueio): AssetHold {
    return new AssetHold(dados);
  }

  static abrir(entrada: {
    id: string;
    tenantId: string;
    assetId: string;
    reason: HoldReason;
    periodo: Periodo;
    notes?: string | null;
    agora?: Date;
  }): AssetHold {
    return new AssetHold({
      id: entrada.id,
      tenantId: entrada.tenantId,
      assetId: entrada.assetId,
      reason: entrada.reason,
      startsAt: entrada.periodo.inicio,
      endsAt: entrada.periodo.fim,
      releasedAt: null,
      notes: entrada.notes?.trim() || null,
      createdAt: entrada.agora ?? new Date(),
    });
  }

  get id(): string {
    return this.dados.id;
  }
  get tenantId(): string {
    return this.dados.tenantId;
  }
  get assetId(): string {
    return this.dados.assetId;
  }
  get reason(): HoldReason {
    return this.dados.reason;
  }
  get startsAt(): Date {
    return this.dados.startsAt;
  }
  get endsAt(): Date {
    return this.dados.endsAt;
  }
  get releasedAt(): Date | null {
    return this.dados.releasedAt;
  }
  get notes(): string | null {
    return this.dados.notes;
  }
  get createdAt(): Date {
    return this.dados.createdAt;
  }

  /** Período previsto, como foi combinado. */
  get periodo(): Periodo {
    return Periodo.de(this.dados.startsAt, this.dados.endsAt);
  }

  /**
   * Período que de fato tira o ativo de circulação — encurtado pela liberação.
   * É ele que conta para sobreposição e para a disponibilidade de hoje.
   */
  get periodoEfetivo(): Periodo {
    const previsto = this.periodo;
    return this.dados.releasedAt
      ? previsto.encerradoEm(this.dados.releasedAt)
      : previsto;
  }

  /** O ativo está preso por este bloqueio no instante dado? */
  vigenteEm(instante = new Date()): boolean {
    return this.periodoEfetivo.contem(instante);
  }

  /** Ainda vai (ou está) tirando o ativo de circulação. */
  aberto(agora = new Date()): boolean {
    const efetivo = this.periodoEfetivo;
    return !efetivo.vazio && efetivo.fim.getTime() > agora.getTime();
  }

  release(agora = new Date()): void {
    if (!this.aberto(agora)) {
      throw new HoldAlreadyReleasedError(this.dados.id);
    }
    this.dados = { ...this.dados, releasedAt: agora };
  }
}
