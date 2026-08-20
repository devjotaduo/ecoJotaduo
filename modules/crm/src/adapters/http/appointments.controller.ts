import {
  ApiErrosPadrao,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  problemaSchema,
  RequirePermissions,
  ZodValidationPipe,
} from '@ecojotaduo/http-kit';
import { requireAuth } from '@ecojotaduo/tenant-context';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import type {
  CloseAppointmentUseCase,
  ListAgendaUseCase,
  ScheduleAppointmentUseCase,
} from '../../application/appointments.use-cases';
import {
  CRM_CLOSE_APPOINTMENT,
  CRM_LIST_AGENDA,
  CRM_SCHEDULE_APPOINTMENT,
} from '../../crm.tokens';

import { agendaSchema, agendarSchema, encerrarAgendamentoSchema } from './dto';
import { agendamentoJson } from './presenters';
import { agendamentoResposta, agendamentosPaginados } from './responses';

/** Agenda do CRM: marcar, concluir, cancelar e consultar por período. */
@ApiTags('CRM — Agenda')
@ApiBearerAuth()
@Controller('api/v1/crm/appointments')
export class CrmAppointmentsController {
  constructor(
    @Inject(CRM_SCHEDULE_APPOINTMENT)
    private readonly agendar: ScheduleAppointmentUseCase,
    @Inject(CRM_CLOSE_APPOINTMENT)
    private readonly encerrar: CloseAppointmentUseCase,
    @Inject(CRM_LIST_AGENDA) private readonly agenda: ListAgendaUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('crm.appointment.schedule')
  @ApiOperation({
    operationId: 'crmScheduleAppointment',
    summary: 'Agenda um compromisso',
  })
  @ApiZodBody(agendarSchema)
  @ApiZodResponse(201, agendamentoResposta, 'Compromisso agendado.')
  @ApiZodResponse(409, problemaSchema, 'Conflito com a agenda do responsável.')
  @ApiErrosPadrao()
  async marcar(
    @Body(new ZodValidationPipe(agendarSchema))
    corpo: z.infer<typeof agendarSchema>,
  ) {
    const { tenantId } = requireAuth();
    const agendamento = await this.agendar.execute({
      tenantId,
      customerId: corpo.customerId,
      title: corpo.title,
      scheduledFor: new Date(corpo.scheduledFor),
      durationMinutes: corpo.durationMinutes,
      assignedToId: corpo.assignedToId,
    });
    return agendamentoJson(agendamento);
  }

  @Get()
  @RequirePermissions('crm.appointment.read')
  @ApiOperation({
    operationId: 'crmListAgenda',
    summary: 'Lista a agenda por período',
  })
  @ApiZodQuery(agendaSchema)
  @ApiZodResponse(200, agendamentosPaginados, 'Página de compromissos.')
  @ApiErrosPadrao()
  async listar(
    @Query(new ZodValidationPipe(agendaSchema))
    consulta: z.infer<typeof agendaSchema>,
  ) {
    const { tenantId } = requireAuth();
    const resultado = await this.agenda.execute({
      tenantId,
      from: new Date(consulta.from),
      to: new Date(consulta.to),
      assignedToId: consulta.assignedToId,
      status: consulta.status,
      limit: consulta.limit,
      offset: consulta.offset,
    });

    return {
      items: resultado.items.map(agendamentoJson),
      total: resultado.total,
      limit: consulta.limit,
      offset: consulta.offset,
    };
  }

  @Post(':appointmentId/complete')
  @HttpCode(200)
  @RequirePermissions('crm.appointment.update')
  @ApiOperation({
    operationId: 'crmCompleteAppointment',
    summary: 'Conclui um compromisso',
  })
  @ApiZodBody(encerrarAgendamentoSchema)
  @ApiZodResponse(200, agendamentoResposta, 'Compromisso concluído.')
  @ApiErrosPadrao()
  async concluir(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body(new ZodValidationPipe(encerrarAgendamentoSchema))
    corpo: z.infer<typeof encerrarAgendamentoSchema>,
  ) {
    const { tenantId } = requireAuth();
    const agendamento = await this.encerrar.complete({
      tenantId,
      appointmentId,
      outcome: corpo.outcome,
    });
    return agendamentoJson(agendamento);
  }

  @Post(':appointmentId/cancel')
  @HttpCode(200)
  @RequirePermissions('crm.appointment.update')
  @ApiOperation({
    operationId: 'crmCancelAppointment',
    summary: 'Cancela um compromisso',
  })
  @ApiZodBody(encerrarAgendamentoSchema)
  @ApiZodResponse(200, agendamentoResposta, 'Compromisso cancelado.')
  @ApiErrosPadrao()
  async cancelar(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body(new ZodValidationPipe(encerrarAgendamentoSchema))
    corpo: z.infer<typeof encerrarAgendamentoSchema>,
  ) {
    const { tenantId } = requireAuth();
    const agendamento = await this.encerrar.cancel({
      tenantId,
      appointmentId,
      reason: corpo.outcome,
    });
    return agendamentoJson(agendamento);
  }
}
