import type { ModuleManifest } from '@ecojotaduo/platform-kernel';

export const IDENTITY_MODULE_ID = 'identity';

export const identityManifest: ModuleManifest = {
  id: IDENTITY_MODULE_ID,
  name: 'Identidade',
  version: '0.1.0',
  description:
    'Usuários, credenciais, service accounts e sessões da plataforma.',
  dependencies: [],
  permissions: [
    {
      key: 'platform.user.read',
      description: 'Consultar usuários da plataforma.',
    },
    {
      key: 'platform.user.manage',
      description: 'Criar, alterar e desativar usuários.',
    },
  ],
  events: [
    {
      type: 'identity.user.created.v1',
      description: 'Um usuário foi criado na plataforma.',
    },
  ],
  minimumPlatformVersion: '0.1.0',
  migrations: { packageName: '@ecojotaduo/identity' },
};
