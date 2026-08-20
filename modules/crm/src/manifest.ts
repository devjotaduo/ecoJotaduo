import type { ModuleManifest } from '@ecojotaduo/platform-kernel';

export const CRM_MODULE_ID = 'crm';

export const crmManifest: ModuleManifest = {
  id: CRM_MODULE_ID,
  name: 'CRM',
  version: '0.1.0',
  description:
    'Clientes, notas de relacionamento e agenda de compromissos comerciais.',
  dependencies: [],
  permissions: [
    {
      key: 'crm.customer.read',
      description: 'Consultar clientes e seu histórico.',
    },
    { key: 'crm.customer.create', description: 'Cadastrar clientes.' },
    { key: 'crm.customer.update', description: 'Alterar dados de clientes.' },
    {
      key: 'crm.note.create',
      description: 'Registrar notas no histórico do cliente.',
    },
    {
      key: 'crm.appointment.read',
      description: 'Consultar a agenda de compromissos.',
    },
    {
      key: 'crm.appointment.schedule',
      description: 'Agendar compromissos com clientes.',
    },
    {
      key: 'crm.appointment.update',
      description: 'Concluir ou cancelar compromissos.',
    },
  ],
  events: [
    {
      type: 'crm.customer.created.v1',
      description: 'Um cliente foi cadastrado.',
    },
    {
      type: 'crm.customer.updated.v1',
      description: 'Dados de um cliente mudaram.',
    },
    {
      type: 'crm.note.added.v1',
      description: 'Uma nota foi registrada no histórico do cliente.',
    },
    {
      type: 'crm.appointment.scheduled.v1',
      description: 'Um compromisso foi agendado com o cliente.',
    },
    {
      type: 'crm.appointment.completed.v1',
      description: 'Um compromisso foi realizado.',
    },
    {
      type: 'crm.appointment.canceled.v1',
      description: 'Um compromisso foi cancelado.',
    },
  ],
  minimumPlatformVersion: '0.1.0',
  migrations: { packageName: '@ecojotaduo/crm' },
};
