import {
  AppointmentInThePastError,
  AppointmentNotOpenError,
  InvalidAppointmentDurationError,
  InvalidAppointmentTitleError,
} from './errors';

export type AppointmentStatus = 'scheduled' | 'done' | 'canceled';

export const DURACAO_MINIMA = 5;
export const DURACAO_MAXIMA = 480;

export interface AppointmentProps {
  readonly id: string;
  readonly customerId: string;
  readonly title: string;
  readonly scheduledFor: Date;
  readonly durationMinutes: number;
  readonly assignedToId: string | null;
  readonly status: AppointmentStatus;
  readonly outcome: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Intervalo ocupado por um agendamento; base da detecção de conflito. */
export interface Periodo {
  readonly inicio: Date;
  readonly fim: Date;
}

/**
 * Agendamento com um cliente (visita, reunião, ligação).
 *
 * As invariantes moram aqui: não se agenda no passado, a duração tem limites,
 * e um agendamento concluído ou cancelado não muda mais de estado. A detecção
 * de conflito de agenda é decidida aqui (`conflitaCom`), mas quem procura os
 * candidatos é o repositório — o domínio não consulta banco.
 */
export class Appointment {
  private constructor(private props: AppointmentProps) {}

  static schedule(entrada: {
    id: string;
    customerId: string;
    title: string;
    scheduledFor: Date;
    durationMinutes: number;
    assignedToId?: string | null;
    agora?: Date;
  }): Appointment {
    const agora = entrada.agora ?? new Date();

    if (
      !Number.isInteger(entrada.durationMinutes) ||
      entrada.durationMinutes < DURACAO_MINIMA ||
      entrada.durationMinutes > DURACAO_MAXIMA
    ) {
      throw new InvalidAppointmentDurationError();
    }
    if (entrada.scheduledFor.getTime() <= agora.getTime()) {
      throw new AppointmentInThePastError();
    }

    const titulo = entrada.title.trim();
    if (titulo.length === 0 || titulo.length > 200) {
      throw new InvalidAppointmentTitleError();
    }

    return new Appointment({
      id: entrada.id,
      customerId: entrada.customerId,
      title: titulo,
      scheduledFor: entrada.scheduledFor,
      durationMinutes: entrada.durationMinutes,
      assignedToId: entrada.assignedToId ?? null,
      status: 'scheduled',
      outcome: null,
      createdAt: agora,
      updatedAt: agora,
    });
  }

  static restore(props: AppointmentProps): Appointment {
    return new Appointment(props);
  }

  get id(): string {
    return this.props.id;
  }
  get customerId(): string {
    return this.props.customerId;
  }
  get title(): string {
    return this.props.title;
  }
  get scheduledFor(): Date {
    return this.props.scheduledFor;
  }
  get durationMinutes(): number {
    return this.props.durationMinutes;
  }
  get assignedToId(): string | null {
    return this.props.assignedToId;
  }
  get status(): AppointmentStatus {
    return this.props.status;
  }
  get outcome(): string | null {
    return this.props.outcome;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get periodo(): Periodo {
    return {
      inicio: this.props.scheduledFor,
      fim: new Date(
        this.props.scheduledFor.getTime() + this.props.durationMinutes * 60_000,
      ),
    };
  }

  /**
   * Sobreposição de horário do MESMO responsável.
   *
   * Encostar não conflita: um agendamento que termina 14:00 e outro que começa
   * 14:00 convivem (comparação estrita nas duas pontas).
   */
  conflitaCom(outro: Appointment): boolean {
    if (this.props.status !== 'scheduled' || outro.status !== 'scheduled') {
      return false;
    }
    if (
      !this.props.assignedToId ||
      this.props.assignedToId !== outro.assignedToId
    ) {
      return false;
    }
    return (
      this.periodo.inicio < outro.periodo.fim &&
      outro.periodo.inicio < this.periodo.fim
    );
  }

  private assertAberto(): void {
    if (this.props.status !== 'scheduled') {
      throw new AppointmentNotOpenError(this.props.status);
    }
  }

  complete(outcome: string | null = null, agora: Date = new Date()): void {
    this.assertAberto();
    this.props = {
      ...this.props,
      status: 'done',
      outcome: outcome?.trim() || null,
      updatedAt: agora,
    };
  }

  cancel(motivo: string | null = null, agora: Date = new Date()): void {
    this.assertAberto();
    this.props = {
      ...this.props,
      status: 'canceled',
      outcome: motivo?.trim() || null,
      updatedAt: agora,
    };
  }
}
