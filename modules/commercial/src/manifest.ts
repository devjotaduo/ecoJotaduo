import type { ModuleManifest } from '@ecojotaduo/platform-kernel';

export const COMMERCIAL_MODULE_ID = 'commercial';

/**
 * Módulo Comercial.
 *
 * Depende do CRM porque uma proposta é sempre PARA um cliente — a referência
 * é conferida contra a superfície pública do CRM, nunca contra a tabela dele.
 * A dependência de Catalog prevista no mapa de módulos ainda não existe: no
 * escopo mínimo o item da proposta é descrito à mão, e ganha referência ao
 * catálogo quando o catálogo existir.
 */
export const commercialManifest: ModuleManifest = {
  id: COMMERCIAL_MODULE_ID,
  name: 'Comercial',
  version: '0.1.0',
  description:
    'Propostas comerciais: elaboração, envio ao cliente e decisão (aceite ou recusa).',
  dependencies: [{ moduleId: 'crm', versionRange: '^0.1.0' }],
  permissions: [
    {
      key: 'commercial.proposal.read',
      description: 'Consultar propostas comerciais.',
    },
    {
      key: 'commercial.proposal.create',
      description: 'Elaborar propostas em rascunho.',
    },
    {
      key: 'commercial.proposal.update',
      description: 'Alterar propostas ainda em rascunho.',
    },
    {
      key: 'commercial.proposal.send',
      description: 'Enviar uma proposta ao cliente.',
    },
    {
      key: 'commercial.proposal.approve',
      description: 'Registrar o aceite ou a recusa de uma proposta.',
    },
  ],
  events: [
    {
      type: 'commercial.proposal.sent.v1',
      description: 'Uma proposta foi enviada ao cliente.',
    },
    {
      type: 'commercial.proposal.approved.v1',
      description: 'O cliente aceitou uma proposta.',
    },
    {
      type: 'commercial.proposal.rejected.v1',
      description: 'O cliente recusou uma proposta.',
    },
  ],
  minimumPlatformVersion: '0.1.0',
  migrations: { packageName: '@ecojotaduo/commercial' },
};
