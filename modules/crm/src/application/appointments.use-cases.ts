import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';
import type { EventPublisher } from '@ecojotaduo/events';
import type { UnitOfWork } from '@ecojotaduo/platform-kernel';

import { Appointment, type AppointmentStatus } from '../domain/appointment';
import {
  AppointmentConflictError,
  AppointmentNotFoundError,
  CustomerNotFoundError,
} from '../domain/errors';
import type {
  AppointmentRepository,
  CustomerRepository,
  Pagina,
  Paginado,
} from '../ports/repositories';

export class ScheduleAppointmentUseCase {
  constructor(
    private readonly clientes: CustomerRepository,
    private readonly agendamentos: AppointmentRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    customerId: string;
    title: string;
    scheduledFor: Date;
    durationMinutes: number;
    assignedToId?: string | null;
  }): Promise<Appointment> {
    const cliente = await this.clientes.findById(
      entrada.tenantId,
      entrada.customerId,
    );
    if (!cliente) {
      throw new CustomerNotFoundError(entrada.customerId);
    }
    cliente.assertAceitaInteracao();

    const agendamento = Appointment.schedule({ id: randomUUID(), ...entrada });

    // Conflito de agenda: o repositório traz os candidatos da janela, o
    // domínio decide se há sobreposição de fato.
    if (agendamento.assignedToId) {
      const abertos = await this.agendamentos.findOpenForAssignee(
        entrada.tenantId,
        agendamento.assignedToId,
        agendamento.periodo,
      );
      const conflitante = abertos.find((outro) =>
        agendamento.conflitaCom(outro),
      );
      if (conflitante) {
        throw new AppointmentConflictError(
          conflitante.id,
          conflitante.scheduledFor,
        );
      }
    }

    await this.uow.executar(entrada.tenantId, async () => {
      await this.agendamentos.save(entrada.tenantId, agendamento);
      await this.eventos.publish({
        type: 'crm.appointment.scheduled.v1',
        resourceType: 'appointment',
        resourceId: agendamento.id,
        payload: {
          customerId: cliente.id,
          title: agendamento.title,
          scheduledFor: agendamento.scheduledFor.toISOString(),
        },
      });
      await this.audit.record({
        action: 'crm.appointment.scheduled',
        result: 'success',
        resourceType: 'appointment',
        resourceId: agendamento.id,
        metadata: {
          customerId: cliente.id,
          scheduledFor: agendamento.scheduledFor.toISOString(),
        },
      });
    });

    return agendamento;
  }
}

/** Conclusão e cancelamento compartilham a mesma forma; só muda a transição. */
export class CloseAppointmentUseCase {
  constructor(
    private readonly agendamentos: AppointmentRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async complete(entrada: {
    tenantId: string;
    appointmentId: string;
    outcome?: string | null;
  }): Promise<Appointment> {
    const agendamento = await this.carregar(
      entrada.tenantId,
      entrada.appointmentId,
    );
    agendamento.complete(entrada.outcome ?? null);
    return this.persistir(
      entrada.tenantId,
      agendamento,
      'crm.appointment.completed',
    );
  }

  async cancel(entrada: {
    tenantId: string;
    appointmentId: string;
    reason?: string | null;
  }): Promise<Appointment> {
    const agendamento = await this.carregar(
      entrada.tenantId,
      entrada.appointmentId,
    );
    agendamento.cancel(entrada.reason ?? null);
    return this.persistir(
      entrada.tenantId,
      agendamento,
      'crm.appointment.canceled',
    );
  }

  private async carregar(
    tenantId: string,
    appointmentId: string,
  ): Promise<Appointment> {
    const agendamento = await this.agendamentos.findById(
      tenantId,
      appointmentId,
    );
    if (!agendamento) {
      throw new AppointmentNotFoundError(appointmentId);
    }
    return agendamento;
  }

  private async persistir(
    tenantId: string,
    agendamento: Appointment,
    acao: string,
  ): Promise<Appointment> {
    await this.uow.executar(tenantId, async () => {
      await this.agendamentos.save(tenantId, agendamento);
      await this.eventos.publish({
        type: `${acao}.v1`,
        resourceType: 'appointment',
        resourceId: agendamento.id,
        payload: { customerId: agendamento.customerId },
      });
      await this.audit.record({
        action: acao,
        result: 'success',
        resourceType: 'appointment',
        resourceId: agendamento.id,
      });
    });
    return agendamento;
  }
}

/** Agenda por período — a consulta que a tela de agenda faz. */
export class ListAgendaUseCase {
  constructor(private readonly agendamentos: AppointmentRepository) {}

  execute(
    entrada: {
      tenantId: string;
      from: Date;
      to: Date;
      assignedToId?: string;
      status?: AppointmentStatus;
    } & Pagina,
  ): Promise<Paginado<Appointment>> {
    if (entrada.to.getTime() <= entrada.from.getTime()) {
      throw new Error('O fim do período precisa ser posterior ao início.');
    }

    return this.agendamentos.listByPeriod(
      entrada.tenantId,
      { inicio: entrada.from, fim: entrada.to },
      {
        assignedToId: entrada.assignedToId,
        status: entrada.status,
        limit: Math.min(Math.max(entrada.limit, 1), 200),
        offset: Math.max(entrada.offset, 0),
      },
    );
  }
}
