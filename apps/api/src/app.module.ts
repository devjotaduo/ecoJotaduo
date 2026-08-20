import { loadEnv, type Env } from '@ecojotaduo/config';
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
    DatabaseLifecycle,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
