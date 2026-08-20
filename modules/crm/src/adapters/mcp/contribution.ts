import { z } from 'zod';

import type {
  CloseAppointmentUseCase,
  ListAgendaUseCase,
  ScheduleAppointmentUseCase,
} from '../../application/appointments.use-cases';
import type {
  CreateCustomerUseCase,
  GetCustomerUseCase,
  SearchCustomersUseCase,
} from '../../application/customers.use-cases';
import type { AddCustomerNoteUseCase } from '../../application/notes.use-cases';
import {
  agendamentoJson,
  clienteJson,
  historicoJson,
  notaJson,
} from '../http/presenters';

/**
 * Contribuição MCP do CRM.
 *
 * As tools NÃO reimplementam nada: recebem os mesmos casos de uso que o
 * controller REST e devolvem a mesma forma de dado (mesmos presenters). O
 * gateway MCP chega na Fase 5; o que existe aqui já é executável e testado,
 * o que torna o critério "REST e MCP executam o mesmo caso de uso"
 * verificável hoje, e não uma promessa.
 *
 * Regras aplicadas (docs/architecture/mcp-model.md):
 * - o tenant vem do contexto autenticado, nunca de parâmetro da tool;
 * - toda tool declara permissões e se é leitura ou escrita;
 * - nomes seguem `dominio.entidade.acao`.
 */

export interface McpToolContext {
  readonly tenantId: string;
  readonly actorId: string;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly requiredPermissions: readonly string[];
  readonly readOnly: boolean;
  /** A entrada já vem validada pelo `inputSchema` (o gateway valida antes). */
  handle(entrada: never, contexto: McpToolContext): Promise<unknown>;
}

/**
 * Declara uma tool inferindo o tipo de entrada a partir do schema.
 *
 * A lista guarda tools de entradas diferentes; `handle(entrada: never)` no
 * contrato é o que permite guardá-las juntas sem elenco (contravariância) e,
 * de quebra, obriga quem chama a tool a validar antes pelo `inputSchema` —
 * que é exatamente o que o gateway MCP faz.
 */
function definirTool<S extends z.ZodType>(definicao: {
  name: string;
  description: string;
  inputSchema: S;
  requiredPermissions: readonly string[];
  readOnly: boolean;
  handle(entrada: z.output<S>, contexto: McpToolContext): Promise<unknown>;
}): McpToolDefinition {
  return definicao;
}

export interface CrmUseCases {
  readonly criarCliente: CreateCustomerUseCase;
  readonly obterCliente: GetCustomerUseCase;
  readonly pesquisarClientes: SearchCustomersUseCase;
  readonly adicionarNota: AddCustomerNoteUseCase;
  readonly agendar: ScheduleAppointmentUseCase;
  readonly encerrarAgendamento: CloseAppointmentUseCase;
  readonly listarAgenda: ListAgendaUseCase;
}

export function crmMcpTools(casos: CrmUseCases): McpToolDefinition[] {
  return [
    definirTool({
      name: 'crm.customer.search',
      description:
        'Pesquisa clientes da empresa por nome, e-mail ou documento. Devolve lista paginada.',
      inputSchema: z.object({
        termo: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      }),
      requiredPermissions: ['crm.customer.read'],
      readOnly: true,
      handle: async (entrada, contexto) => {
        const resultado = await casos.pesquisarClientes.execute({
          tenantId: contexto.tenantId,
          termo: entrada.termo,
          limit: entrada.limit,
          offset: entrada.offset,
        });
        return {
          items: resultado.items.map(clienteJson),
          total: resultado.total,
        };
      },
    }),

    definirTool({
      name: 'crm.customer.get',
      description:
        'Obtém um cliente com sua linha do tempo (notas e agendamentos recentes).',
      inputSchema: z.object({
        customerId: z.uuid(),
        historicoLimite: z.number().int().min(1).max(50).default(20),
      }),
      requiredPermissions: ['crm.customer.read'],
      readOnly: true,
      handle: async (entrada, contexto) => {
        const { customer, timeline } = await casos.obterCliente.execute({
          tenantId: contexto.tenantId,
          customerId: entrada.customerId,
          historicoLimite: entrada.historicoLimite,
        });
        return {
          ...clienteJson(customer),
          timeline: timeline.map(historicoJson),
        };
      },
    }),

    definirTool({
      name: 'crm.customer.create',
      description: 'Cadastra um cliente novo. Recusa documento já cadastrado.',
      inputSchema: z.object({
        name: z.string().min(2).max(200),
        document: z.string().min(11).max(20).nullish(),
        email: z.email().max(254).nullish(),
        phone: z.string().max(30).nullish(),
      }),
      requiredPermissions: ['crm.customer.create'],
      readOnly: false,
      handle: async (entrada, contexto) => {
        const cliente = await casos.criarCliente.execute({
          tenantId: contexto.tenantId,
          name: entrada.name,
          document: entrada.document,
          email: entrada.email,
          phone: entrada.phone,
        });
        return clienteJson(cliente);
      },
    }),

    definirTool({
      name: 'crm.note.add',
      description:
        'Registra uma nota de relacionamento no histórico do cliente. Notas não podem ser editadas depois.',
      inputSchema: z.object({
        customerId: z.uuid(),
        body: z.string().min(1).max(5000),
      }),
      requiredPermissions: ['crm.note.create'],
      readOnly: false,
      handle: async (entrada, contexto) => {
        const nota = await casos.adicionarNota.execute({
          tenantId: contexto.tenantId,
          customerId: entrada.customerId,
          body: entrada.body,
          authorId: contexto.actorId,
        });
        return notaJson(nota);
      },
    }),

    definirTool({
      name: 'crm.appointment.schedule',
      description:
        'Agenda um compromisso com o cliente. Recusa horário no passado e sobreposição na agenda do responsável.',
      inputSchema: z.object({
        customerId: z.uuid(),
        title: z.string().min(1).max(200),
        scheduledFor: z.iso.datetime(),
        durationMinutes: z.number().int().min(5).max(480),
        assignedToId: z.uuid().nullish(),
      }),
      requiredPermissions: ['crm.appointment.schedule'],
      readOnly: false,
      handle: async (entrada, contexto) => {
        const agendamento = await casos.agendar.execute({
          tenantId: contexto.tenantId,
          customerId: entrada.customerId,
          title: entrada.title,
          scheduledFor: new Date(entrada.scheduledFor),
          durationMinutes: entrada.durationMinutes,
          assignedToId: entrada.assignedToId,
        });
        return agendamentoJson(agendamento);
      },
    }),

    definirTool({
      name: 'crm.appointment.complete',
      description:
        'Marca um agendamento como realizado, registrando o desfecho.',
      inputSchema: z.object({
        appointmentId: z.uuid(),
        outcome: z.string().max(2000).nullish(),
      }),
      requiredPermissions: ['crm.appointment.update'],
      readOnly: false,
      handle: async (entrada, contexto) => {
        const agendamento = await casos.encerrarAgendamento.complete({
          tenantId: contexto.tenantId,
          appointmentId: entrada.appointmentId,
          outcome: entrada.outcome,
        });
        return agendamentoJson(agendamento);
      },
    }),

    definirTool({
      name: 'crm.agenda.list',
      description:
        'Lista os compromissos de um período (a agenda). Aceita filtro por responsável e status.',
      inputSchema: z.object({
        from: z.iso.datetime(),
        to: z.iso.datetime(),
        assignedToId: z.uuid().optional(),
        status: z.enum(['scheduled', 'done', 'canceled']).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
      requiredPermissions: ['crm.appointment.read'],
      readOnly: true,
      handle: async (entrada, contexto) => {
        const resultado = await casos.listarAgenda.execute({
          tenantId: contexto.tenantId,
          from: new Date(entrada.from),
          to: new Date(entrada.to),
          assignedToId: entrada.assignedToId,
          status: entrada.status,
          limit: entrada.limit,
          offset: entrada.offset,
        });
        return {
          items: resultado.items.map(agendamentoJson),
          total: resultado.total,
        };
      },
    }),
  ];
}
