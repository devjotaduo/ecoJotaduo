import { definirTool, type McpContribution } from '@ecojotaduo/mcp-kit';
import { z } from 'zod';

import type {
  ActivateContractUseCase,
  CloseContractUseCase,
  CreateContractUseCase,
  GetContractUseCase,
  SearchContractsUseCase,
} from '../../application/contracts.use-cases';
import { contratoJson } from '../http/presenters';

/**
 * Contribuição MCP de Contratos.
 *
 * As tools são intenções de negócio — formalizar, colocar em vigor, encerrar —
 * e chamam os mesmos casos de uso do REST. Um agente não consegue formalizar
 * um contrato a partir de uma proposta que o cliente não aceitou, porque a
 * regra não está na borda: está no caso de uso que as duas usam.
 */

export interface ContractsUseCases {
  readonly formalizar: CreateContractUseCase;
  readonly obter: GetContractUseCase;
  readonly pesquisar: SearchContractsUseCase;
  readonly ativar: ActivateContractUseCase;
  readonly encerrar: CloseContractUseCase;
}

export function contractsMcpContribution(
  casos: ContractsUseCases,
): McpContribution {
  return {
    tools: [
      definirTool({
        name: 'contracts.contract.search',
        description:
          'Pesquisa contratos da empresa por cliente, situação ou título. A situação inclui "expired" para vigência encerrada.',
        inputSchema: z.object({
          customerId: z.uuid().optional(),
          status: z
            .enum(['draft', 'active', 'finished', 'canceled'])
            .optional(),
          termo: z.string().max(120).optional(),
          limit: z.number().int().min(1).max(50).default(20),
          offset: z.number().int().min(0).default(0),
        }),
        requiredPermissions: ['contracts.contract.read'],
        readOnly: true,
        handle: async (entrada, contexto) => {
          const resultado = await casos.pesquisar.execute({
            tenantId: contexto.tenantId,
            ...entrada,
          });
          return {
            items: resultado.items.map(contratoJson),
            total: resultado.total,
          };
        },
      }),

      definirTool({
        name: 'contracts.contract.get',
        description:
          'Obtém um contrato com vigência, valor e situação (inclusive se está em vigor agora).',
        inputSchema: z.object({ contractId: z.uuid() }),
        requiredPermissions: ['contracts.contract.read'],
        readOnly: true,
        handle: async (entrada, contexto) =>
          contratoJson(
            await casos.obter.execute({
              tenantId: contexto.tenantId,
              contractId: entrada.contractId,
            }),
          ),
      }),

      definirTool({
        name: 'contracts.contract.create',
        description:
          'Formaliza um contrato a partir de uma proposta ACEITA. Cliente, título e valor vêm da proposta — só a vigência é informada.',
        inputSchema: z.object({
          proposalId: z.uuid(),
          startsOn: z.iso.datetime(),
          endsOn: z.iso.datetime(),
          notes: z.string().max(5000).nullish(),
        }),
        requiredPermissions: ['contracts.contract.create'],
        readOnly: false,
        handle: async (entrada, contexto) =>
          contratoJson(
            await casos.formalizar.execute({
              tenantId: contexto.tenantId,
              proposalId: entrada.proposalId,
              startsOn: new Date(entrada.startsOn),
              endsOn: new Date(entrada.endsOn),
              notes: entrada.notes,
            }),
          ),
      }),

      definirTool({
        name: 'contracts.contract.activate',
        description: 'Coloca um contrato em rascunho em vigor.',
        inputSchema: z.object({ contractId: z.uuid() }),
        requiredPermissions: ['contracts.contract.activate'],
        readOnly: false,
        handle: async (entrada, contexto) =>
          contratoJson(
            await casos.ativar.execute({
              tenantId: contexto.tenantId,
              contractId: entrada.contractId,
            }),
          ),
      }),

      definirTool({
        name: 'contracts.contract.close',
        description:
          'Encerra um contrato ativo: "finish" quando cumpriu o previsto, "cancel" quando foi interrompido antes.',
        inputSchema: z.object({
          contractId: z.uuid(),
          outcome: z.enum(['finish', 'cancel']),
          reason: z.string().max(2000).nullish(),
        }),
        requiredPermissions: ['contracts.contract.close'],
        readOnly: false,
        handle: async (entrada, contexto) => {
          const alvo = {
            tenantId: contexto.tenantId,
            contractId: entrada.contractId,
            reason: entrada.reason,
          };
          return contratoJson(
            entrada.outcome === 'finish'
              ? await casos.encerrar.finish(alvo)
              : await casos.encerrar.cancel(alvo),
          );
        },
      }),
    ],
    resources: [],
    prompts: [],
  };
}
