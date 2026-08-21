import type { PluginManifest } from '@ecojotaduo/plugin-sdk';

export const NOTIFICATIONS_PLUGIN_ID = 'notifications-example';

/**
 * Manifesto do plugin de exemplo.
 *
 * Ele existe para provar o ciclo completo com UM plugin de verdade, em vez de
 * um SDK generalizado sem consumidor: instalação por empresa, permissão
 * concedida e verificada, segredo cifrado, capacidade que só aparece quando
 * habilitada.
 */
export const notificationsManifest: PluginManifest = {
  manifestVersion: '1',
  id: NOTIFICATIONS_PLUGIN_ID,
  name: 'Notificações (exemplo)',
  version: '1.0.0',
  publisher: 'ecoJotaduo',
  type: 'first-party',
  platformVersion: '^0.1.0',
  description:
    'Entrega mensagens em um webhook da empresa, assinadas com HMAC-SHA256.',
  // Só o que ele realmente usa: o nome do cliente citado na mensagem.
  permissions: ['crm.customer.read'],
  capabilities: { http: true, mcp: true },
  requiredSecrets: ['signingSecret'],
  subscribesTo: [],
  publishes: [],
};
