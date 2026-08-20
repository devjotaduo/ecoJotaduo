import {
  definirTool,
  type McpContribution,
  type McpPromptDefinition,
  type McpResourceDefinition,
  type McpToolContext,
  type McpToolDefinition,
} from '@ecojotaduo/mcp-kit';
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
 * controller REST e devolvem a mesma forma de dado (mesmos presenters). É o
 * que torna verificável — e não uma promessa — o critério "REST e MCP
 * executam o mesmo caso de uso".
 *
 * Regras aplicadas (docs/architecture/mcp-model.md):
 * - o tenant vem do contexto autenticado, nunca de parâmetro da tool;
 * - toda capacidade declara permissões e se é leitura ou escrita;
 * - nomes seguem `dominio.entidade.acao`.
 */

export interface CrmUseCases {
  readonly criarCliente: CreateCustomerUseCase;
  readonly obterCliente: GetCustomerUseCase;
  readonly pesquisarClientes: SearchCustomersUseCase;
  readonly adicionarNota: AddCustomerNoteUseCase;
  readonly agendar: ScheduleAppointmentUseCase;
  readonly encerrarAgendamento: CloseAppointmentUseCase;
  readonly listarAgenda: ListAgendaUseCase;
}

const LEITURA_CLIENTE = ['crm.customer.read'] as const;

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
      requiredPermissions: LEITURA_CLIENTE,
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
      requiredPermissions: LEITURA_CLIENTE,
      readOnly: true,
      handle: (entrada, contexto) =>
        clienteComHistorico(
          casos,
          contexto,
          entrada.customerId,
          entrada.historicoLimite,
        ),
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

/**
 * Resources: leitura endereçável por URI, para o host anexar contexto sem
 * "executar uma ação". Mesma permissão e mesmo caso de uso da tool de leitura
 * — mudar a forma de endereçar não pode virar um caminho alternativo de
 * acesso.
 */
function crmMcpResources(casos: CrmUseCases): McpResourceDefinition[] {
  return [
    {
      name: 'crm.customer',
      uriTemplate: 'crm://customers/{customerId}',
      description: 'Ficha do cliente com a linha do tempo recente.',
      mimeType: 'application/json',
      requiredPermissions: LEITURA_CLIENTE,
      read: (variaveis, contexto) =>
        clienteComHistorico(casos, contexto, exigirUuid(variaveis.customerId)),
    },
    {
      name: 'crm.customer.history',
      uriTemplate: 'crm://customers/{customerId}/history',
      description:
        'Somente a linha do tempo (notas e compromissos) do cliente.',
      mimeType: 'application/json',
      requiredPermissions: LEITURA_CLIENTE,
      read: async (variaveis, contexto) => {
        const { timeline } = await casos.obterCliente.execute({
          tenantId: contexto.tenantId,
          customerId: exigirUuid(variaveis.customerId),
          historicoLimite: 50,
        });
        return { items: timeline.map(historicoJson) };
      },
    },
  ];
}

/**
 * Prompt: roteiro de análise já preenchido com os dados do tenant. O texto é
 * montado no servidor, então o host recebe conteúdo pronto em vez de uma
 * instrução para ir buscar dado por conta própria.
 */
function crmMcpPrompts(casos: CrmUseCases): McpPromptDefinition[] {
  return [
    {
      name: 'crm.customer.analysis',
      description:
        'Roteiro de análise do relacionamento com um cliente, já com ficha e histórico carregados.',
      requiredPermissions: LEITURA_CLIENTE,
      arguments: [
        {
          name: 'customerId',
          description: 'Identificador do cliente a analisar.',
          required: true,
        },
      ],
      build: async (argumentos, contexto) => {
        const dados = await clienteComHistorico(
          casos,
          contexto,
          exigirUuid(argumentos.customerId),
          50,
        );
        return {
          description: `Análise de relacionamento — ${dados.name}`,
          text: [
            'Analise o relacionamento comercial com este cliente e responda em português.',
            'Aponte: situação atual, sinais de risco, compromissos em aberto e próximo passo recomendado.',
            'Use apenas os dados abaixo; não invente fatos que não estejam aqui.',
            '',
            JSON.stringify(dados, null, 2),
          ].join('\n'),
        };
      },
    },
  ];
}

export function crmMcpContribution(casos: CrmUseCases): McpContribution {
  return {
    tools: crmMcpTools(casos),
    resources: crmMcpResources(casos),
    prompts: crmMcpPrompts(casos),
  };
}

/** Tool, resource e prompt de leitura convergem aqui — uma forma só de dado. */
async function clienteComHistorico(
  casos: CrmUseCases,
  contexto: McpToolContext,
  customerId: string,
  historicoLimite = 20,
) {
  const { customer, timeline } = await casos.obterCliente.execute({
    tenantId: contexto.tenantId,
    customerId,
    historicoLimite,
  });
  return { ...clienteJson(customer), timeline: timeline.map(historicoJson) };
}

/**
 * Variável de URI e argumento de prompt chegam como texto livre; o caso de uso
 * espera um id. Validar aqui mantém a mesma barreira que o `inputSchema` das
 * tools dá — nenhuma das três portas de leitura fica mais frouxa que as outras.
 */
function exigirUuid(valor: string | undefined): string {
  return z.uuid().parse(valor);
}
