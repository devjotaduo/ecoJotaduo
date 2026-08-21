import { definirTool, type McpContribution } from '@ecojotaduo/mcp-kit';
import { z } from 'zod';

import type {
  CancelRentalUseCase,
  FinishRentalUseCase,
  GetRentalUseCase,
  ScheduleRentalUseCase,
  SearchRentalsUseCase,
  StartRentalUseCase,
} from '../../application/rentals.use-cases';
import { locacaoJson } from '../http/presenters';

/**
 * Contribuição MCP de Operações.
 *
 * As tools são intenções de negócio — programar, retirar, devolver — e chamam
 * os mesmos casos de uso do REST. Um agente não consegue programar locação
 * fora da vigência do contrato nem sobre equipamento comprometido, porque a
 * regra não está na borda: está no caso de uso, e a garantia final é a
 * restrição de exclusão em Ativos.
 */

export interface OperationsUseCases {
  readonly programar: ScheduleRentalUseCase;
  readonly obter: GetRentalUseCase;
  readonly pesquisar: SearchRentalsUseCase;
  readonly retirar: StartRentalUseCase;
  readonly devolver: FinishRentalUseCase;
  readonly cancelar: CancelRentalUseCase;
}

export function operationsMcpContribution(
  casos: OperationsUseCases,
): McpContribution {
  return {
    tools: [
      definirTool({
        name: 'operations.rental.search',
        description:
          'Pesquisa locações por contrato, cliente, equipamento ou situação. ' +
          'Use `atrasadas: true` para as que estão em andamento com o prazo vencido.',
        inputSchema: z.object({
          contractId: z.uuid().optional(),
          customerId: z.uuid().optional(),
          assetId: z.uuid().optional(),
          status: z
            .enum(['scheduled', 'active', 'finished', 'canceled'])
            .optional(),
          atrasadas: z.boolean().optional(),
          limit: z.number().int().min(1).max(50).default(20),
          offset: z.number().int().min(0).default(0),
        }),
        requiredPermissions: ['operations.rental.read'],
        readOnly: true,
        handle: async (entrada, contexto) => {
          const resultado = await casos.pesquisar.execute({
            tenantId: contexto.tenantId,
            ...entrada,
          });
          return {
            items: resultado.items.map(locacaoJson),
            total: resultado.total,
          };
        },
      }),

      definirTool({
        name: 'operations.rental.get',
        description:
          'Obtém uma locação com situação, prazo e dias de atraso (quando houver).',
        inputSchema: z.object({ rentalId: z.uuid() }),
        requiredPermissions: ['operations.rental.read'],
        readOnly: true,
        handle: async (entrada, contexto) =>
          locacaoJson(
            await casos.obter.execute({
              tenantId: contexto.tenantId,
              rentalId: entrada.rentalId,
            }),
          ),
      }),

      definirTool({
        name: 'operations.rental.schedule',
        description:
          'Programa a locação de um equipamento sob um contrato EM VIGOR. O período precisa caber ' +
          'na vigência do contrato, e o equipamento é reservado no patrimônio — se já estiver ' +
          'comprometido no intervalo, a programação é recusada.',
        inputSchema: z.object({
          contractId: z.uuid(),
          assetId: z.uuid(),
          startsAt: z.iso.datetime(),
          endsAt: z.iso.datetime(),
          notes: z.string().max(5000).nullish(),
        }),
        requiredPermissions: ['operations.rental.create'],
        readOnly: false,
        handle: async (entrada, contexto) =>
          locacaoJson(
            await casos.programar.execute({
              tenantId: contexto.tenantId,
              contractId: entrada.contractId,
              assetId: entrada.assetId,
              startsAt: new Date(entrada.startsAt),
              endsAt: new Date(entrada.endsAt),
              notes: entrada.notes,
            }),
          ),
      }),

      definirTool({
        name: 'operations.rental.start',
        description: 'Registra a retirada: o equipamento saiu para o cliente.',
        inputSchema: z.object({ rentalId: z.uuid() }),
        requiredPermissions: ['operations.rental.manage'],
        readOnly: false,
        handle: async (entrada, contexto) =>
          locacaoJson(
            await casos.retirar.execute({
              tenantId: contexto.tenantId,
              rentalId: entrada.rentalId,
            }),
          ),
      }),

      definirTool({
        name: 'operations.rental.close',
        description:
          'Encerra a locação: "finish" quando o equipamento voltou (libera o pátio na hora, mesmo ' +
          'adiantado), "cancel" quando foi desmarcada antes de sair.',
        inputSchema: z.object({
          rentalId: z.uuid(),
          outcome: z.enum(['finish', 'cancel']),
          reason: z.string().max(2000).nullish(),
        }),
        requiredPermissions: ['operations.rental.manage'],
        readOnly: false,
        handle: async (entrada, contexto) => {
          const alvo = {
            tenantId: contexto.tenantId,
            rentalId: entrada.rentalId,
            reason: entrada.reason,
          };
          return locacaoJson(
            entrada.outcome === 'finish'
              ? await casos.devolver.execute(alvo)
              : await casos.cancelar.execute(alvo),
          );
        },
      }),
    ],
    resources: [],
    prompts: [],
  };
}
