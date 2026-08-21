import type { ModuleManifest } from '@ecojotaduo/platform-kernel';

export const CONTRACTS_MODULE_ID = 'contracts';

/**
 * Módulo Contratos.
 *
 * Depende do Comercial porque um contrato nasce de uma proposta ACEITA — a
 * referência é conferida contra a superfície pública do Comercial, nunca
 * contra as tabelas dele.
 */
export const contractsManifest: ModuleManifest = {
  id: CONTRACTS_MODULE_ID,
  name: 'Contratos',
  version: '0.1.0',
  description:
    'Contratos formalizados a partir de propostas aceitas: vigência, ativação e encerramento.',
  dependencies: [{ moduleId: 'commercial', versionRange: '^0.1.0' }],
  permissions: [
    { key: 'contracts.contract.read', description: 'Consultar contratos.' },
    {
      key: 'contracts.contract.create',
      description: 'Formalizar um contrato a partir de uma proposta aceita.',
    },
    {
      key: 'contracts.contract.activate',
      description: 'Colocar um contrato em vigor.',
    },
    {
      key: 'contracts.contract.close',
      description: 'Encerrar ou cancelar um contrato ativo.',
    },
  ],
  events: [
    {
      type: 'contracts.contract.activated.v1',
      description: 'Um contrato entrou em vigor.',
    },
    {
      type: 'contracts.contract.finished.v1',
      description: 'Um contrato foi encerrado.',
    },
    {
      type: 'contracts.contract.canceled.v1',
      description: 'Um contrato foi cancelado antes do fim previsto.',
    },
  ],
  minimumPlatformVersion: '0.1.0',
  migrations: { packageName: '@ecojotaduo/contracts' },
};
