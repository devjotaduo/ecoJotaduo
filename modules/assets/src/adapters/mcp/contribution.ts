import {
  definirTool,
  type McpContribution,
  type McpResourceDefinition,
  type McpToolContext,
  type McpToolDefinition,
} from '@ecojotaduo/mcp-kit';
import { z } from 'zod';

import type {
  CheckAvailabilityUseCase,
  GetAssetUseCase,
  HoldAssetUseCase,
  RegisterAssetUseCase,
  ReleaseHoldUseCase,
  RetireAssetUseCase,
  SearchAssetsUseCase,
  UpdateAssetUseCase,
} from '../../application/assets.use-cases';
import { MOTIVOS_DE_BLOQUEIO } from '../../domain/hold';
import {
  ativoJson,
  bloqueioJson,
  disponibilidadeJson,
} from '../http/presenters';

/**
 * Contribuição MCP de Ativos.
 *
 * A tool que justifica o módulo para um agente é `assets.asset.availability`:
 * "este equipamento está livre nessa semana?". A resposta não vem de uma
 * coluna que alguém precisou lembrar de atualizar — sai dos bloqueios, no
 * mesmo caso de uso que o REST usa.
 *
 * Um agente também não consegue bloquear um ativo já comprometido: a regra
 * está no caso de uso, e a restrição de exclusão do banco fecha a corrida.
 */

export interface AssetsUseCases {
  readonly cadastrar: RegisterAssetUseCase;
  readonly atualizar: UpdateAssetUseCase;
  readonly obter: GetAssetUseCase;
  readonly pesquisar: SearchAssetsUseCase;
  readonly bloquear: HoldAssetUseCase;
  readonly liberar: ReleaseHoldUseCase;
  readonly baixar: RetireAssetUseCase;
  readonly disponibilidade: CheckAvailabilityUseCase;
}

const LEITURA = ['assets.asset.read'] as const;

export function assetsMcpTools(casos: AssetsUseCases): McpToolDefinition[] {
  return [
    definirTool({
      name: 'assets.asset.search',
      description:
        'Pesquisa equipamentos da empresa por categoria, código, nome ou disponibilidade. ' +
        '"available" e "held" refletem os bloqueios do instante consultado.',
      inputSchema: z.object({
        category: z.string().max(80).optional(),
        availability: z.enum(['available', 'held', 'retired']).optional(),
        termo: z.string().max(120).optional(),
        em: z.iso
          .datetime()
          .optional()
          .describe(
            'Instante de referência da disponibilidade. Padrão: agora.',
          ),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      }),
      requiredPermissions: LEITURA,
      readOnly: true,
      handle: async (entrada, contexto) => {
        const resultado = await casos.pesquisar.execute({
          tenantId: contexto.tenantId,
          ...entrada,
          em: entrada.em ? new Date(entrada.em) : undefined,
        });
        return {
          items: resultado.items.map(ativoJson),
          total: resultado.total,
        };
      },
    }),

    definirTool({
      name: 'assets.asset.get',
      description:
        'Obtém um equipamento com a situação atual e o histórico de bloqueios.',
      inputSchema: z.object({ assetId: z.uuid() }),
      requiredPermissions: LEITURA,
      readOnly: true,
      handle: (entrada, contexto) =>
        ativoComHistorico(casos, contexto, entrada.assetId),
    }),

    definirTool({
      name: 'assets.asset.availability',
      description:
        'Responde se um equipamento está livre num período e, se não estiver, o que o ocupa. ' +
        'É a pergunta a fazer ANTES de prometer o equipamento a alguém.',
      inputSchema: z.object({
        assetId: z.uuid(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
      }),
      requiredPermissions: LEITURA,
      readOnly: true,
      handle: async (entrada, contexto) =>
        disponibilidadeJson(
          await casos.disponibilidade.execute({
            tenantId: contexto.tenantId,
            assetId: entrada.assetId,
            startsAt: new Date(entrada.startsAt),
            endsAt: new Date(entrada.endsAt),
          }),
        ),
    }),

    definirTool({
      name: 'assets.asset.register',
      description:
        'Cadastra um equipamento no patrimônio da empresa. O código é a identificação de patrimônio e não se repete.',
      inputSchema: z.object({
        code: z.string().min(1).max(60),
        name: z.string().min(2).max(200),
        category: z.string().min(2).max(80),
        serialNumber: z.string().max(120).nullish(),
        acquiredOn: z.iso.datetime().nullish(),
        notes: z.string().max(5000).nullish(),
      }),
      requiredPermissions: ['assets.asset.manage'],
      readOnly: false,
      handle: async (entrada, contexto) => {
        const ativo = await casos.cadastrar.execute({
          tenantId: contexto.tenantId,
          code: entrada.code,
          name: entrada.name,
          category: entrada.category,
          serialNumber: entrada.serialNumber,
          acquiredOn: entrada.acquiredOn ? new Date(entrada.acquiredOn) : null,
          notes: entrada.notes,
        });
        return ativoJson({
          asset: ativo,
          availability: 'available',
          currentHold: null,
        });
      },
    }),

    definirTool({
      name: 'assets.asset.update',
      description: 'Corrige o cadastro de um equipamento em operação.',
      inputSchema: z.object({
        assetId: z.uuid(),
        name: z.string().min(2).max(200).optional(),
        category: z.string().min(2).max(80).optional(),
        serialNumber: z.string().max(120).nullish(),
        acquiredOn: z.iso.datetime().nullish(),
        notes: z.string().max(5000).nullish(),
      }),
      requiredPermissions: ['assets.asset.manage'],
      readOnly: false,
      handle: async (entrada, contexto) => {
        const { assetId, acquiredOn, ...mudancas } = entrada;
        await casos.atualizar.execute({
          tenantId: contexto.tenantId,
          assetId,
          ...mudancas,
          acquiredOn: acquiredOn ? new Date(acquiredOn) : undefined,
        });
        return ativoComHistorico(casos, contexto, assetId, 1);
      },
    }),

    definirTool({
      name: 'assets.asset.hold',
      description:
        'Tira um equipamento de circulação num período, com motivo. Recusa se ele já estiver comprometido no intervalo.',
      inputSchema: z.object({
        assetId: z.uuid(),
        reason: z.enum(MOTIVOS_DE_BLOQUEIO),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        notes: z.string().max(2000).nullish(),
      }),
      requiredPermissions: ['assets.asset.hold'],
      readOnly: false,
      handle: async (entrada, contexto) =>
        bloqueioJson(
          await casos.bloquear.execute({
            tenantId: contexto.tenantId,
            assetId: entrada.assetId,
            reason: entrada.reason,
            startsAt: new Date(entrada.startsAt),
            endsAt: new Date(entrada.endsAt),
            notes: entrada.notes,
          }),
        ),
    }),

    definirTool({
      name: 'assets.asset.release',
      description:
        'Libera um bloqueio agora, devolvendo o equipamento à operação antes do previsto.',
      inputSchema: z.object({ holdId: z.uuid() }),
      requiredPermissions: ['assets.asset.hold'],
      readOnly: false,
      handle: async (entrada, contexto) =>
        bloqueioJson(
          await casos.liberar.execute({
            tenantId: contexto.tenantId,
            holdId: entrada.holdId,
          }),
        ),
    }),

    definirTool({
      name: 'assets.asset.retire',
      description:
        'Dá baixa definitiva no equipamento (venda, perda ou fim de vida). Não tem volta.',
      inputSchema: z.object({
        assetId: z.uuid(),
        reason: z.string().max(2000).nullish(),
      }),
      requiredPermissions: ['assets.asset.retire'],
      readOnly: false,
      handle: async (entrada, contexto) => {
        const ativo = await casos.baixar.execute({
          tenantId: contexto.tenantId,
          assetId: entrada.assetId,
          reason: entrada.reason,
        });
        return ativoJson({
          asset: ativo,
          availability: 'retired',
          currentHold: null,
        });
      },
    }),
  ];
}

function assetsMcpResources(casos: AssetsUseCases): McpResourceDefinition[] {
  return [
    {
      name: 'assets.asset',
      uriTemplate: 'assets://assets/{assetId}',
      description:
        'Ficha do equipamento com a situação atual e o histórico de bloqueios.',
      mimeType: 'application/json',
      requiredPermissions: LEITURA,
      read: (variaveis, contexto) =>
        ativoComHistorico(casos, contexto, exigirUuid(variaveis.assetId)),
    },
  ];
}

export function assetsMcpContribution(casos: AssetsUseCases): McpContribution {
  return {
    tools: assetsMcpTools(casos),
    resources: assetsMcpResources(casos),
    prompts: [],
  };
}

/** Tool e resource de leitura convergem aqui — uma forma só de dado. */
async function ativoComHistorico(
  casos: AssetsUseCases,
  contexto: McpToolContext,
  assetId: string,
  historicoLimite = 20,
) {
  const resultado = await casos.obter.execute({
    tenantId: contexto.tenantId,
    assetId,
    historicoLimite,
  });
  return {
    ...ativoJson(resultado),
    history: resultado.history.map(bloqueioJson),
  };
}

/**
 * Variável de URI chega como texto livre; o caso de uso espera um id. Validar
 * aqui mantém a mesma barreira que o `inputSchema` das tools dá.
 */
function exigirUuid(valor: string | undefined): string {
  return z.uuid().parse(valor);
}
