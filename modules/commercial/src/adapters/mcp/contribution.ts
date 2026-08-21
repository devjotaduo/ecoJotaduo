import { definirTool, type McpContribution } from '@ecojotaduo/mcp-kit';
import { z } from 'zod';

import type {
  CreateProposalUseCase,
  DecideProposalUseCase,
  GetProposalUseCase,
  SearchProposalsUseCase,
  SendProposalUseCase,
} from '../../application/proposals.use-cases';
import { propostaJson } from '../http/presenters';

/**
 * Contribuição MCP do Comercial.
 *
 * As tools representam **intenções de negócio** (`commercial.proposal.approve`),
 * não CRUD espelhado — é o exemplo que o próprio modelo MCP cita. E chamam os
 * mesmos casos de uso do REST: um agente não tem caminho alternativo para
 * aprovar uma proposta sem passar pelas mesmas invariantes.
 */

export interface CommercialUseCases {
  readonly criarProposta: CreateProposalUseCase;
  readonly obterProposta: GetProposalUseCase;
  readonly pesquisarPropostas: SearchProposalsUseCase;
  readonly enviarProposta: SendProposalUseCase;
  readonly decidirProposta: DecideProposalUseCase;
}

const itemSchema = z.object({
  description: z.string().min(2).max(300),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPriceCents: z
    .number()
    .int()
    .min(0)
    .describe('Preço unitário em CENTAVOS (ex.: 199900 = R$ 1.999,00).'),
  discountCents: z.number().int().min(0).optional(),
});

export function commercialMcpContribution(
  casos: CommercialUseCases,
): McpContribution {
  return {
    tools: [
      definirTool({
        name: 'commercial.proposal.search',
        description:
          'Pesquisa propostas da empresa por cliente, situação ou título. Devolve lista paginada com totais.',
        inputSchema: z.object({
          customerId: z.uuid().optional(),
          status: z.enum(['draft', 'sent', 'accepted', 'rejected']).optional(),
          termo: z.string().max(120).optional(),
          limit: z.number().int().min(1).max(50).default(20),
          offset: z.number().int().min(0).default(0),
        }),
        requiredPermissions: ['commercial.proposal.read'],
        readOnly: true,
        handle: async (entrada, contexto) => {
          const resultado = await casos.pesquisarPropostas.execute({
            tenantId: contexto.tenantId,
            ...entrada,
          });
          return {
            items: resultado.items.map((proposta) => propostaJson(proposta)),
            total: resultado.total,
          };
        },
      }),

      definirTool({
        name: 'commercial.proposal.get',
        description:
          'Obtém uma proposta com itens, total e situação (inclusive vencida).',
        inputSchema: z.object({ proposalId: z.uuid() }),
        requiredPermissions: ['commercial.proposal.read'],
        readOnly: true,
        handle: async (entrada, contexto) => {
          const { proposal, customerName } = await casos.obterProposta.execute({
            tenantId: contexto.tenantId,
            proposalId: entrada.proposalId,
          });
          return propostaJson(proposal, customerName);
        },
      }),

      definirTool({
        name: 'commercial.proposal.create',
        description:
          'Elabora uma proposta em rascunho para um cliente do CRM. Valores em centavos; o total é calculado pelo servidor.',
        inputSchema: z.object({
          customerId: z.uuid(),
          title: z.string().min(2).max(200),
          currency: z.string().regex(/^[A-Z]{3}$/),
          validUntil: z.iso.datetime(),
          notes: z.string().max(5000).nullish(),
          items: z.array(itemSchema).max(200).optional(),
        }),
        requiredPermissions: ['commercial.proposal.create'],
        readOnly: false,
        handle: async (entrada, contexto) => {
          const proposta = await casos.criarProposta.execute({
            tenantId: contexto.tenantId,
            customerId: entrada.customerId,
            title: entrada.title,
            currency: entrada.currency,
            validUntil: new Date(entrada.validUntil),
            notes: entrada.notes,
            items: entrada.items,
          });
          return propostaJson(proposta);
        },
      }),

      definirTool({
        name: 'commercial.proposal.send',
        description:
          'Envia a proposta ao cliente. A partir daí os valores não mudam mais.',
        inputSchema: z.object({ proposalId: z.uuid() }),
        requiredPermissions: ['commercial.proposal.send'],
        readOnly: false,
        handle: async (entrada, contexto) => {
          const proposta = await casos.enviarProposta.execute({
            tenantId: contexto.tenantId,
            proposalId: entrada.proposalId,
          });
          return propostaJson(proposta);
        },
      }),

      definirTool({
        name: 'commercial.proposal.approve',
        description:
          'Registra a decisão do cliente sobre uma proposta enviada: aceite ou recusa. Proposta vencida é recusada pelo servidor.',
        inputSchema: z.object({
          proposalId: z.uuid(),
          decision: z.enum(['accept', 'reject']),
        }),
        requiredPermissions: ['commercial.proposal.approve'],
        readOnly: false,
        handle: async (entrada, contexto) => {
          const alvo = {
            tenantId: contexto.tenantId,
            proposalId: entrada.proposalId,
          };
          const proposta =
            entrada.decision === 'accept'
              ? await casos.decidirProposta.accept(alvo)
              : await casos.decidirProposta.reject(alvo);
          return propostaJson(proposta);
        },
      }),
    ],
    resources: [],
    prompts: [],
  };
}
