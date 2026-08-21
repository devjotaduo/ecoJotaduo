import type { PluginDefinition } from '@ecojotaduo/plugin-sdk';

import {
  configuracaoDeNotificacoes,
  type ConfiguracaoDeNotificacoes,
} from './config';
import { destinoPublicoHttps, type PoliticaDeDestino } from './domain/destino';
import { notificationsManifest } from './manifest';

/**
 * O plugin montado: manifesto + schema de configuração + diagnóstico.
 *
 * A política de destino entra por parâmetro para o teste poder falar com um
 * servidor local; em produção vale a padrão, que recusa rede interna.
 *
 * O health check confere o destino de verdade. Sem ele, "habilitado" viraria
 * sinônimo de "funcionando" no painel — e um webhook apontando para lugar
 * nenhum só apareceria quando alguém reclamasse de mensagem não entregue.
 */
export function definirPluginDeNotificacoes(
  politica: PoliticaDeDestino = destinoPublicoHttps,
): PluginDefinition<ConfiguracaoDeNotificacoes> {
  return {
    manifest: notificationsManifest,
    configSchema: configuracaoDeNotificacoes,
    verificarSaude: async (runtime) => {
      try {
        await politica(new URL(runtime.config.webhookUrl));
        return { status: 'healthy' };
      } catch (erro) {
        return {
          status: 'unavailable',
          detail: erro instanceof Error ? erro.message : 'Destino inválido.',
        };
      }
    },
  };
}
