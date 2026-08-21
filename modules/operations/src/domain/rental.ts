import {
  InvalidRentalPeriodError,
  RentalAlreadyStartedError,
  RentalNotActiveError,
  RentalNotScheduledError,
} from './errors';

/**
 * Locação: o equipamento na mão do cliente, sob um contrato.
 *
 * Estados guardados: `scheduled`, `active`, `finished`, `canceled`.
 *
 * `overdue` **não é guardado** — é derivado de `endsAt`. Uma locação em
 * andamento cujo prazo passou está atrasada no instante em que passa, e é
 * disso que sai cobrança extra. Guardada em coluna, dependeria de um job
 * rodar para virar verdade, e o equipamento ficaria "no prazo" até lá.
 */
export type RentalStatus = 'scheduled' | 'active' | 'finished' | 'canceled';

/** O que a leitura enxerga, com o prazo já aplicado. */
export type RentalView = RentalStatus | 'overdue';

export interface DadosDaLocacao {
  readonly id: string;
  readonly tenantId: string;
  readonly number: number;
  /** Contrato que cobre esta locação. Sem contrato, não há locação. */
  readonly contractId: string;
  /** Copiado do contrato — a locação é para o cliente dele, não para outro. */
  readonly customerId: string;
  readonly assetId: string;
  /** Copiado do patrimônio, para a listagem não precisar de uma ida por linha. */
  readonly assetCode: string;
  /** Reserva criada em Ativos. É ela que impede duas locações no mesmo período. */
  readonly holdId: string;
  readonly status: RentalStatus;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly canceledAt: Date | null;
  readonly closeReason: string | null;
}

export class Rental {
  private constructor(private dados: DadosDaLocacao) {}

  static restore(dados: DadosDaLocacao): Rental {
    return new Rental(dados);
  }

  static schedule(entrada: {
    id: string;
    tenantId: string;
    number: number;
    contractId: string;
    customerId: string;
    assetId: string;
    assetCode: string;
    holdId: string;
    startsAt: Date;
    endsAt: Date;
    notes?: string | null;
    agora?: Date;
  }): Rental {
    const agora = entrada.agora ?? new Date();
    if (entrada.endsAt.getTime() <= entrada.startsAt.getTime()) {
      throw new InvalidRentalPeriodError(
        'a devolução precisa ser depois da retirada',
      );
    }
    if (entrada.endsAt.getTime() <= agora.getTime()) {
      throw new InvalidRentalPeriodError('o prazo já teria terminado');
    }

    return new Rental({
      id: entrada.id,
      tenantId: entrada.tenantId,
      number: entrada.number,
      contractId: entrada.contractId,
      customerId: entrada.customerId,
      assetId: entrada.assetId,
      assetCode: entrada.assetCode,
      holdId: entrada.holdId,
      status: 'scheduled',
      startsAt: entrada.startsAt,
      endsAt: entrada.endsAt,
      notes: entrada.notes?.trim() || null,
      createdAt: agora,
      updatedAt: agora,
      startedAt: null,
      finishedAt: null,
      canceledAt: null,
      closeReason: null,
    });
  }

  get id(): string {
    return this.dados.id;
  }
  get tenantId(): string {
    return this.dados.tenantId;
  }
  get number(): number {
    return this.dados.number;
  }
  get contractId(): string {
    return this.dados.contractId;
  }
  get customerId(): string {
    return this.dados.customerId;
  }
  get assetId(): string {
    return this.dados.assetId;
  }
  get assetCode(): string {
    return this.dados.assetCode;
  }
  get holdId(): string {
    return this.dados.holdId;
  }
  get status(): RentalStatus {
    return this.dados.status;
  }
  get startsAt(): Date {
    return this.dados.startsAt;
  }
  get endsAt(): Date {
    return this.dados.endsAt;
  }
  get notes(): string | null {
    return this.dados.notes;
  }
  get createdAt(): Date {
    return this.dados.createdAt;
  }
  get updatedAt(): Date {
    return this.dados.updatedAt;
  }
  get startedAt(): Date | null {
    return this.dados.startedAt;
  }
  get finishedAt(): Date | null {
    return this.dados.finishedAt;
  }
  get canceledAt(): Date | null {
    return this.dados.canceledAt;
  }
  get closeReason(): string | null {
    return this.dados.closeReason;
  }

  /** Em andamento com o prazo vencido — derivado, não guardado. */
  estaAtrasada(agora = new Date()): boolean {
    return (
      this.dados.status === 'active' &&
      this.dados.endsAt.getTime() <= agora.getTime()
    );
  }

  situacao(agora = new Date()): RentalView {
    return this.estaAtrasada(agora) ? 'overdue' : this.dados.status;
  }

  /** Dias de atraso, para a cobrança extra. Zero quando está no prazo. */
  diasDeAtraso(agora = new Date()): number {
    if (!this.estaAtrasada(agora)) {
      return 0;
    }
    const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;
    return Math.ceil(
      (agora.getTime() - this.dados.endsAt.getTime()) / MILISSEGUNDOS_POR_DIA,
    );
  }

  /** Retirada: o equipamento saiu. */
  start(agora = new Date()): void {
    if (this.dados.status !== 'scheduled') {
      throw new RentalNotScheduledError(this.dados.status);
    }
    this.dados = {
      ...this.dados,
      status: 'active',
      startedAt: agora,
      updatedAt: agora,
    };
  }

  /**
   * Devolução: o equipamento voltou.
   *
   * Vale mesmo atrasada — é assim que a situação para de ser `overdue`. Recusar
   * a devolução de uma locação vencida deixaria o equipamento preso para sempre.
   */
  finish(motivo: string | null, agora = new Date()): void {
    if (this.dados.status !== 'active') {
      throw new RentalNotActiveError(this.dados.status);
    }
    this.dados = {
      ...this.dados,
      status: 'finished',
      finishedAt: agora,
      closeReason: motivo?.trim() || null,
      updatedAt: agora,
    };
  }

  /** Cancelamento: só antes de o equipamento sair. */
  cancel(motivo: string | null, agora = new Date()): void {
    if (this.dados.status === 'active') {
      throw new RentalAlreadyStartedError();
    }
    if (this.dados.status !== 'scheduled') {
      throw new RentalNotScheduledError(this.dados.status);
    }
    this.dados = {
      ...this.dados,
      status: 'canceled',
      canceledAt: agora,
      closeReason: motivo?.trim() || null,
      updatedAt: agora,
    };
  }

  /** A reserva do equipamento ainda precisa existir? */
  get prendeOEquipamento(): boolean {
    return this.dados.status === 'scheduled' || this.dados.status === 'active';
  }
}
