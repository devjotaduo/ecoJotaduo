import type { ModuleManifest } from '@movimentar/platform-kernel';

export const TENANCY_MODULE_ID = 'tenancy';

export const tenancyManifest: ModuleManifest = {
  id: TENANCY_MODULE_ID,
  name: 'Tenancy',
  version: '0.1.0',
  description:
    'Organizações, tenants, vínculos, papéis e contratação de módulos por empresa.',
  dependencies: [{ moduleId: 'identity', versionRange: '^0.1.0' }],
  permissions: [
    {
      key: 'platform.tenant.read',
      description: 'Consultar dados da própria empresa.',
    },
    {
      key: 'platform.module.manage',
      description: 'Contratar e cancelar módulos da empresa.',
    },
    {
      key: 'platform.audit.read',
      description: 'Consultar a trilha de auditoria da empresa.',
    },
  ],
  events: [
    {
      type: 'tenancy.tenant.created.v1',
      description: 'Uma empresa foi criada na plataforma.',
    },
    {
      type: 'tenancy.entitlement.granted.v1',
      description: 'Um módulo foi contratado por uma empresa.',
    },
  ],
  minimumPlatformVersion: '0.1.0',
  migrations: { packageName: '@movimentar/tenancy' },
};
