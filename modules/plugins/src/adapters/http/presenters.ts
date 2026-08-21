import type { PluginNoCatalogo } from '../../application/manage-plugins.use-cases';
import type { PluginInstallation } from '../../domain/installation';

/**
 * Conversão de domínio para JSON.
 *
 * Repare no que NÃO aparece: valor de segredo. A instalação devolve apenas as
 * chaves configuradas, e é assim que tem que ser — um segredo que volta numa
 * listagem acaba em log de proxy, em histórico de navegador e em captura de
 * tela de suporte.
 */

export function instalacaoJson(instalacao: PluginInstallation) {
  return {
    pluginId: instalacao.pluginId,
    version: instalacao.version,
    status: instalacao.status,
    config: instalacao.config,
    grantedPermissions: [...instalacao.grantedPermissions],
    installedAt: instalacao.installedAt.toISOString(),
    updatedAt: instalacao.updatedAt.toISOString(),
  };
}

export function pluginJson(item: PluginNoCatalogo) {
  return {
    pluginId: item.pluginId,
    name: item.name,
    description: item.description,
    version: item.version,
    publisher: item.publisher,
    type: item.type,
    requestedPermissions: [...item.requestedPermissions],
    requiredSecrets: [...item.requiredSecrets],
    installation: item.installation
      ? {
          status: item.installation.status,
          version: item.installation.version,
          config: item.installation.config,
          grantedPermissions: [...item.installation.grantedPermissions],
          configuredSecrets: [...item.installation.configuredSecrets],
          installedAt: item.installation.installedAt.toISOString(),
          updatedAt: item.installation.updatedAt.toISOString(),
          health: item.installation.health
            ? {
                status: item.installation.health.status,
                detail: item.installation.health.detail ?? null,
              }
            : null,
        }
      : null,
  };
}
