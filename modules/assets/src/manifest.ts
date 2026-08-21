import type { ModuleManifest } from '@ecojotaduo/platform-kernel';

export const ASSETS_MODULE_ID = 'assets';

/**
 * Módulo Ativos.
 *
 * Não depende de nenhum outro módulo: o patrimônio existe antes de qualquer
 * contrato ou locação. Quem depende dele é Operações (para prometer o
 * equipamento) e Manutenção (para tirá-lo de circulação).
 */
export const assetsManifest: ModuleManifest = {
  id: ASSETS_MODULE_ID,
  name: 'Ativos',
  version: '0.1.0',
  description:
    'Equipamentos da empresa: identificação, bloqueios por período, disponibilidade e baixa.',
  dependencies: [],
  permissions: [
    {
      key: 'assets.asset.read',
      description: 'Consultar ativos e disponibilidade.',
    },
    {
      key: 'assets.asset.manage',
      description: 'Cadastrar e corrigir o cadastro de ativos.',
    },
    {
      key: 'assets.asset.hold',
      description: 'Bloquear e liberar ativos — operação do dia a dia.',
    },
    {
      key: 'assets.asset.retire',
      description: 'Dar baixa definitiva em um ativo. Não tem volta.',
    },
  ],
  events: [
    {
      type: 'assets.asset.registered.v1',
      description: 'Um equipamento entrou no patrimônio da empresa.',
    },
    {
      type: 'assets.asset.unavailable.v1',
      description: 'Um equipamento saiu de circulação por um período.',
    },
    {
      type: 'assets.asset.available.v1',
      description:
        'Um bloqueio foi liberado e o equipamento voltou à operação.',
    },
    {
      type: 'assets.asset.retired.v1',
      description: 'Um equipamento recebeu baixa definitiva.',
    },
  ],
  minimumPlatformVersion: '0.1.0',
  migrations: { packageName: '@ecojotaduo/assets' },
};
