import type { ModuleManifest } from '@ecojotaduo/platform-kernel';

export const PLUGINS_MODULE_ID = 'plugins';

/**
 * Registry de plugins.
 *
 * As permissões usam o prefixo `platform.*` — administrar extensões é função
 * da plataforma, não um módulo de negócio que a empresa contrata à parte. É
 * também o único prefixo isento de entitlement (ver packages/permissions).
 */
export const pluginsManifest: ModuleManifest = {
  id: PLUGINS_MODULE_ID,
  name: 'Plugins',
  version: '0.1.0',
  description:
    'Catálogo de extensões, instalação por empresa, segredos de integração e ciclo de vida.',
  dependencies: [],
  permissions: [
    {
      key: 'platform.plugin.read',
      description: 'Consultar o catálogo de plugins e o estado da instalação.',
    },
    {
      key: 'platform.plugin.manage',
      description:
        'Instalar, configurar, habilitar, desabilitar e remover plugins da empresa.',
    },
  ],
  events: [
    {
      type: 'platform.plugin.enabled.v1',
      description: 'Um plugin foi habilitado para a empresa.',
    },
    {
      type: 'platform.plugin.disabled.v1',
      description: 'Um plugin foi desabilitado para a empresa.',
    },
  ],
  minimumPlatformVersion: '0.1.0',
  migrations: { packageName: '@ecojotaduo/plugins' },
};
