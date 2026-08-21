import type { ModuleManifest } from '@ecojotaduo/platform-kernel';

export const OPERATIONS_MODULE_ID = 'operations';

/**
 * Módulo Operações.
 *
 * Depende de Contratos (a locação só existe sob um contrato em vigor) e de
 * Ativos (é lá que o equipamento fica reservado). As duas referências passam
 * pelas superfícies públicas, nunca pelas tabelas alheias.
 */
export const operationsManifest: ModuleManifest = {
  id: OPERATIONS_MODULE_ID,
  name: 'Operações',
  version: '0.1.0',
  description:
    'Locações de equipamento sob contrato: programação, retirada, devolução e cancelamento.',
  dependencies: [
    { moduleId: 'contracts', versionRange: '^0.1.0' },
    { moduleId: 'assets', versionRange: '^0.1.0' },
  ],
  permissions: [
    { key: 'operations.rental.read', description: 'Consultar locações.' },
    {
      key: 'operations.rental.create',
      description: 'Programar uma locação sob um contrato em vigor.',
    },
    {
      key: 'operations.rental.manage',
      description: 'Registrar retirada, devolução e cancelamento.',
    },
  ],
  events: [
    {
      type: 'operations.rental.started.v1',
      description: 'Um equipamento saiu para o cliente.',
    },
    {
      type: 'operations.rental.finished.v1',
      description: 'Um equipamento foi devolvido.',
    },
    {
      type: 'operations.rental.canceled.v1',
      description: 'Uma locação foi cancelada antes da retirada.',
    },
  ],
  minimumPlatformVersion: '0.1.0',
  migrations: { packageName: '@ecojotaduo/operations' },
};
