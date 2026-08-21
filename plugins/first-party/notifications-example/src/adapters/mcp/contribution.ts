import { definirTool, type McpContribution } from '@ecojotaduo/mcp-kit';
import type { PluginRuntimeProvider } from '@ecojotaduo/plugin-sdk';
import { requireAuth } from '@ecojotaduo/tenant-context';
import { z } from 'zod';

import type { SendNotificationUseCase } from '../../application/send-notification.use-case';
import type { ConfiguracaoDeNotificacoes } from '../../config';

/**
 * Contribuição MCP do plugin.
 *
 * Nome no espaço `plugin.<id>.*`, como manda o modelo MCP — e a permissão de
 * mesmo nome faz o catálogo filtrar sozinho: a tool só aparece para empresas
 * com o plugin habilitado, porque o entitlement `plugin.notifications-example`
 * só existe enquanto a instalação estiver ativa.
 *
 * O agente NUNCA vê a URL de destino nem o segredo de assinatura: ele manda a
 * mensagem, o servidor decide para onde vai e assina.
 */
export function notificationsMcpContribution(
  enviar: SendNotificationUseCase,
  provedor: PluginRuntimeProvider<ConfiguracaoDeNotificacoes>,
): McpContribution {
  return {
    tools: [
      definirTool({
        name: 'plugin.notifications-example.message.send',
        description:
          'Entrega uma notificação no canal configurado pela empresa. Aceita citar um cliente do CRM.',
        inputSchema: z.object({
          message: z.string().min(1).max(2000),
          customerId: z.uuid().nullish(),
        }),
        requiredPermissions: ['plugin.notifications-example.message.send'],
        readOnly: false,
        handle: async (entrada, contexto) => {
          const { entitlements } = requireAuth();
          const runtime = await provedor.carregar({
            tenantId: contexto.tenantId,
            actorId: contexto.actorId,
            entitlements,
          });
          return enviar.execute({
            runtime,
            message: entrada.message,
            customerId: entrada.customerId,
          });
        },
      }),
    ],
    resources: [],
    prompts: [],
  };
}
