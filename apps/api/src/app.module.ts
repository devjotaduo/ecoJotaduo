import { loadEnv, type Env } from '@ecojotaduo/config';
import {
  AssetHoldsController,
  AssetsController,
  ASSETS_AVAILABILITY,
  ASSETS_GET,
  ASSETS_HOLD,
  ASSETS_REGISTER,
  ASSETS_RELEASE,
  ASSETS_RETIRE,
  ASSETS_SEARCH,
  ASSETS_UPDATE,
} from '@ecojotaduo/assets';
import {
  CrmAppointmentsController,
  CrmCustomersController,
  CRM_ADD_NOTE,
  CRM_CLOSE_APPOINTMENT,
  CRM_CREATE_CUSTOMER,
  CRM_GET_CUSTOMER,
  CRM_LIST_AGENDA,
  CRM_LIST_NOTES,
  CRM_SCHEDULE_APPOINTMENT,
  CRM_SEARCH_CUSTOMERS,
  CRM_UPDATE_CUSTOMER,
} from '@ecojotaduo/crm';
import {
  CommercialProposalsController,
  COMMERCIAL_CREATE_PROPOSAL,
  COMMERCIAL_DECIDE_PROPOSAL,
  COMMERCIAL_GET_PROPOSAL,
  COMMERCIAL_SEARCH_PROPOSALS,
  COMMERCIAL_SEND_PROPOSAL,
  COMMERCIAL_UPDATE_PROPOSAL,
} from '@ecojotaduo/commercial';
import {
  ContractsController,
  CONTRACTS_ACTIVATE,
  CONTRACTS_CLOSE,
  CONTRACTS_CREATE,
  CONTRACTS_GET,
  CONTRACTS_SEARCH,
} from '@ecojotaduo/contracts';
import {
  RentalsController,
  OPERATIONS_CANCEL,
  OPERATIONS_FINISH,
  OPERATIONS_GET,
  OPERATIONS_SCHEDULE,
  OPERATIONS_SEARCH,
  OPERATIONS_START,
} from '@ecojotaduo/operations';
import {
  NotificationsController,
  NOTIFICATIONS_RUNTIME,
  NOTIFICATIONS_SEND,
} from '@ecojotaduo/plugin-notifications-example';
import {
  PluginsController,
  PLUGINS_CHANGE_STATUS,
  PLUGINS_CONFIGURE,
  PLUGINS_INSTALL,
  PLUGINS_LIST,
} from '@ecojotaduo/plugins';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import {
  criarNucleo,
  type NucleoDaPlataforma,
} from '@ecojotaduo/platform-core';
import { DatabaseLifecycle } from './bootstrap/database-lifecycle';
import {
  AUDIT_LOGGER,
  DATABASE,
  ENV,
  IDENTITY_API,
  ISSUE_SERVICE_TOKEN_USE_CASE,
  MANAGE_ENTITLEMENTS_USE_CASE,
  MODULE_CATALOG,
  PLATFORM_CORE,
  REFRESH_SESSION_USE_CASE,
  SIGN_IN_USE_CASE,
  TENANCY_API,
  TOKEN_SERVICE,
} from './bootstrap/tokens';
import { HealthController } from './health/health.controller';
import { AccessGuard } from './http/access.guard';
import { EntitlementsController } from './tenancy/entitlements.controller';

/** Expõe uma peça do núcleo como provider, sem duplicar a montagem. */
function doNucleo<K extends keyof NucleoDaPlataforma>(token: symbol, chave: K) {
  return {
    provide: token,
    useFactory: (nucleo: NucleoDaPlataforma) => nucleo[chave],
    inject: [PLATFORM_CORE],
  };
}

/** Idem, para os casos de uso de Operações. */
function deOperacoes<K extends keyof NucleoDaPlataforma['operations']>(
  token: symbol,
  chave: K,
) {
  return {
    provide: token,
    useFactory: (nucleo: NucleoDaPlataforma) => nucleo.operations[chave],
    inject: [PLATFORM_CORE],
  };
}

/** Idem, para os casos de uso de Ativos. */
function deAtivos<K extends keyof NucleoDaPlataforma['assets']>(
  token: symbol,
  chave: K,
) {
  return {
    provide: token,
    useFactory: (nucleo: NucleoDaPlataforma) => nucleo.assets[chave],
    inject: [PLATFORM_CORE],
  };
}

/** Idem, para os casos de uso de Contratos. */
function deContratos<K extends keyof NucleoDaPlataforma['contracts']>(
  token: symbol,
  chave: K,
) {
  return {
    provide: token,
    useFactory: (nucleo: NucleoDaPlataforma) => nucleo.contracts[chave],
    inject: [PLATFORM_CORE],
  };
}

/** Idem, para os casos de uso do Comercial. */
function doComercial<K extends keyof NucleoDaPlataforma['commercial']>(
  token: symbol,
  chave: K,
) {
  return {
    provide: token,
    useFactory: (nucleo: NucleoDaPlataforma) => nucleo.commercial[chave],
    inject: [PLATFORM_CORE],
  };
}

/** Idem, para os casos de uso do CRM, que ficam agrupados em `nucleo.crm`. */
function doCrm<K extends keyof NucleoDaPlataforma['crm']>(
  token: symbol,
  chave: K,
) {
  return {
    provide: token,
    useFactory: (nucleo: NucleoDaPlataforma) => nucleo.crm[chave],
    inject: [PLATFORM_CORE],
  };
}

/** Idem, para o registry de plugins e a borda do plugin de exemplo. */
function doPlugins<K extends keyof NucleoDaPlataforma['plugins']>(
  token: symbol,
  chave: K,
) {
  return {
    provide: token,
    useFactory: (nucleo: NucleoDaPlataforma) => nucleo.plugins[chave],
    inject: [PLATFORM_CORE],
  };
}

/**
 * Composition root da API REST.
 *
 * Liga os módulos de domínio aos adaptadores HTTP — nenhuma regra de negócio
 * mora aqui. O `apps/mcp-gateway` e o `apps/worker` terão arquivos
 * equivalentes chamando o mesmo `criarNucleo`.
 */
@Module({
  controllers: [
    HealthController,
    AuthController,
    EntitlementsController,
    AuditController,
    // Controllers do CRM vêm do próprio módulo: ele é dono da sua borda REST.
    CrmCustomersController,
    CrmAppointmentsController,
    CommercialProposalsController,
    ContractsController,
    AssetsController,
    AssetHoldsController,
    RentalsController,
    // Administração de extensões e a borda do plugin de exemplo — este
    // segundo é o que prova que capacidade de plugin só existe quando a
    // empresa habilita.
    PluginsController,
    NotificationsController,
  ],
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnv() },
    {
      provide: PLATFORM_CORE,
      useFactory: (env: Env): NucleoDaPlataforma => criarNucleo(env),
      inject: [ENV],
    },
    doNucleo(DATABASE, 'handle'),
    doNucleo(MODULE_CATALOG, 'catalogo'),
    doNucleo(TOKEN_SERVICE, 'tokens'),
    doNucleo(AUDIT_LOGGER, 'audit'),
    doNucleo(IDENTITY_API, 'identity'),
    doNucleo(TENANCY_API, 'tenancy'),
    doNucleo(SIGN_IN_USE_CASE, 'signIn'),
    doNucleo(REFRESH_SESSION_USE_CASE, 'refreshSession'),
    doNucleo(ISSUE_SERVICE_TOKEN_USE_CASE, 'serviceToken'),
    doNucleo(MANAGE_ENTITLEMENTS_USE_CASE, 'entitlements'),
    // CRM: cada caso de uso é exposto pelo token que o módulo declara, a
    // partir da MESMA instância que alimenta as tools MCP.
    doCrm(CRM_CREATE_CUSTOMER, 'criarCliente'),
    doCrm(CRM_UPDATE_CUSTOMER, 'atualizarCliente'),
    doCrm(CRM_GET_CUSTOMER, 'obterCliente'),
    doCrm(CRM_SEARCH_CUSTOMERS, 'pesquisarClientes'),
    doCrm(CRM_ADD_NOTE, 'adicionarNota'),
    doCrm(CRM_LIST_NOTES, 'listarNotas'),
    doCrm(CRM_SCHEDULE_APPOINTMENT, 'agendar'),
    doCrm(CRM_CLOSE_APPOINTMENT, 'encerrarAgendamento'),
    doCrm(CRM_LIST_AGENDA, 'listarAgenda'),
    doComercial(COMMERCIAL_CREATE_PROPOSAL, 'criarProposta'),
    doComercial(COMMERCIAL_UPDATE_PROPOSAL, 'atualizarProposta'),
    doComercial(COMMERCIAL_GET_PROPOSAL, 'obterProposta'),
    doComercial(COMMERCIAL_SEARCH_PROPOSALS, 'pesquisarPropostas'),
    doComercial(COMMERCIAL_SEND_PROPOSAL, 'enviarProposta'),
    doComercial(COMMERCIAL_DECIDE_PROPOSAL, 'decidirProposta'),
    deContratos(CONTRACTS_CREATE, 'formalizar'),
    deContratos(CONTRACTS_GET, 'obter'),
    deContratos(CONTRACTS_SEARCH, 'pesquisar'),
    deContratos(CONTRACTS_ACTIVATE, 'ativar'),
    deContratos(CONTRACTS_CLOSE, 'encerrar'),
    deAtivos(ASSETS_REGISTER, 'cadastrar'),
    deAtivos(ASSETS_UPDATE, 'atualizar'),
    deAtivos(ASSETS_GET, 'obter'),
    deAtivos(ASSETS_SEARCH, 'pesquisar'),
    deAtivos(ASSETS_HOLD, 'bloquear'),
    deAtivos(ASSETS_RELEASE, 'liberar'),
    deAtivos(ASSETS_RETIRE, 'baixar'),
    deAtivos(ASSETS_AVAILABILITY, 'disponibilidade'),
    deOperacoes(OPERATIONS_SCHEDULE, 'programar'),
    deOperacoes(OPERATIONS_GET, 'obter'),
    deOperacoes(OPERATIONS_SEARCH, 'pesquisar'),
    deOperacoes(OPERATIONS_START, 'retirar'),
    deOperacoes(OPERATIONS_FINISH, 'devolver'),
    deOperacoes(OPERATIONS_CANCEL, 'cancelar'),
    doPlugins(PLUGINS_LIST, 'listar'),
    doPlugins(PLUGINS_INSTALL, 'instalar'),
    doPlugins(PLUGINS_CONFIGURE, 'configurar'),
    doPlugins(PLUGINS_CHANGE_STATUS, 'status'),
    doPlugins(NOTIFICATIONS_SEND, 'notificacoes'),
    doPlugins(NOTIFICATIONS_RUNTIME, 'runtimeDeNotificacoes'),
    DatabaseLifecycle,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
