import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';
import { DrizzleAuditLogger } from '@ecojotaduo/audit/drizzle';
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  opaqueTokenMatches,
  TokenService,
  verifyPassword,
} from '@ecojotaduo/auth';
import type { Env } from '@ecojotaduo/config';
import {
  AddCustomerNoteUseCase,
  CloseAppointmentUseCase,
  CreateCustomerUseCase,
  DrizzleAppointmentRepository,
  DrizzleCustomerNoteRepository,
  DrizzleCustomerRepository,
  GetCustomerUseCase,
  ListAgendaUseCase,
  ListCustomerNotesUseCase,
  ScheduleAppointmentUseCase,
  SearchCustomersUseCase,
  UpdateCustomerUseCase,
  crmMcpContribution,
  type CrmUseCases,
} from '@ecojotaduo/crm';
import { createDatabase, type DatabaseHandle } from '@ecojotaduo/database';
import { McpCatalog } from '@ecojotaduo/mcp-kit';
import {
  DrizzleRefreshTokenRepository,
  DrizzleServiceAccountRepository,
  DrizzleUserRepository,
  IdentityService,
  RefreshTokenUseCase,
  VerifyCredentialsUseCase,
  VerifyServiceAccountUseCase,
  type IdentityPublicApi,
  type PasswordHasher,
  type SecretHasher,
} from '@ecojotaduo/identity';
import type { ResolvedModules } from '@ecojotaduo/platform-kernel';
import {
  DrizzleEntitlementRepository,
  DrizzleMembershipRepository,
  DrizzleTenantRepository,
  IssueServiceTokenUseCase,
  ManageEntitlementsUseCase,
  RefreshSessionUseCase,
  ResolveAccessGrantUseCase,
  SignInUseCase,
  TenancyService,
  type AccessTokenIssuer,
  type TenancyPublicApi,
} from '@ecojotaduo/tenancy';

import { catalogoDeModulos } from './modules';

const hasherDeSenha: PasswordHasher = {
  hash: hashPassword,
  verify: verifyPassword,
};
const hasherDeSegredo: SecretHasher = {
  hash: hashOpaqueToken,
  matches: opaqueTokenMatches,
};

export interface NucleoDaPlataforma {
  readonly handle: DatabaseHandle;
  readonly catalogo: ResolvedModules;
  readonly tokens: TokenService;
  readonly audit: AuditLogger;
  readonly identity: IdentityPublicApi;
  readonly tenancy: TenancyPublicApi;
  readonly signIn: SignInUseCase;
  readonly refreshSession: RefreshSessionUseCase;
  readonly serviceToken: IssueServiceTokenUseCase;
  readonly entitlements: ManageEntitlementsUseCase;
  readonly crm: CrmCompleto;
  /**
   * Catálogo MCP da instalação. Já sabe filtrar por `AccessGrant`; o gateway
   * só o liga ao transporte.
   */
  readonly mcp: McpCatalog;
}

/**
 * Casos de uso do CRM.
 *
 * Estende `CrmUseCases` (o subconjunto que vira tool MCP) com o que hoje só
 * tem borda REST. Passar este objeto para a contribuição MCP funciona por tipagem
 * estrutural — e deixa explícito que não existem duas implementações.
 */
export interface CrmCompleto extends CrmUseCases {
  readonly atualizarCliente: UpdateCustomerUseCase;
  readonly listarNotas: ListCustomerNotesUseCase;
}

/** Adapta o TokenService (criptografia) à porta esperada pelos casos de uso. */
function emissorDeToken(tokens: TokenService): AccessTokenIssuer {
  return {
    issue: (entrada) =>
      tokens.issue({
        sub: entrada.subject,
        tid: entrada.tenantId,
        kind: entrada.kind,
        scope: entrada.scopes,
        jti: randomUUID(),
      }),
  };
}

/**
 * Monta os módulos de domínio uma única vez.
 *
 * Vive num pacote, e não dentro de `apps/api`, porque todo composition root
 * chama esta mesma função: a API REST, o gateway MCP e (na Fase 8) o worker.
 * Nenhuma regra de negócio aqui — só a ligação entre adaptadores concretos e
 * casos de uso. É esta função que garante, na prática, regra de negócio única.
 */
export function criarNucleo(env: Env): NucleoDaPlataforma {
  const catalogo = catalogoDeModulos();
  const handle = createDatabase({
    url: env.DATABASE_URL,
    quiet: env.NODE_ENV === 'test',
  });
  const { db } = handle;

  const tokens = new TokenService({
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  const emissor = emissorDeToken(tokens);
  const audit = new DrizzleAuditLogger(db);

  // --- identity -----------------------------------------------------------
  const usuarios = new DrizzleUserRepository(db);
  const identity = new IdentityService(
    new VerifyCredentialsUseCase(usuarios, hasherDeSenha),
    new VerifyServiceAccountUseCase(
      new DrizzleServiceAccountRepository(db),
      hasherDeSegredo,
    ),
    new RefreshTokenUseCase(
      new DrizzleRefreshTokenRepository(db),
      hasherDeSegredo,
      { create: createOpaqueToken },
      env.REFRESH_TOKEN_TTL_DAYS,
    ),
    usuarios,
  );

  // --- tenancy ------------------------------------------------------------
  const tenantsRepo = new DrizzleTenantRepository(db);
  const entitlementsRepo = new DrizzleEntitlementRepository(db);
  const resolverAcesso = new ResolveAccessGrantUseCase(
    tenantsRepo,
    new DrizzleMembershipRepository(db),
    entitlementsRepo,
  );

  // --- crm ----------------------------------------------------------------
  const clientesRepo = new DrizzleCustomerRepository(db);
  const notasRepo = new DrizzleCustomerNoteRepository(db);
  const agendamentosRepo = new DrizzleAppointmentRepository(db);

  // Uma instância de cada caso de uso, compartilhada por REST e MCP. É esta
  // linha que garante, na prática, que as duas bordas não divirjam.
  const crm: CrmCompleto = {
    criarCliente: new CreateCustomerUseCase(clientesRepo, audit),
    atualizarCliente: new UpdateCustomerUseCase(clientesRepo, audit),
    obterCliente: new GetCustomerUseCase(
      clientesRepo,
      notasRepo,
      agendamentosRepo,
    ),
    pesquisarClientes: new SearchCustomersUseCase(clientesRepo),
    adicionarNota: new AddCustomerNoteUseCase(clientesRepo, notasRepo, audit),
    listarNotas: new ListCustomerNotesUseCase(clientesRepo, notasRepo),
    agendar: new ScheduleAppointmentUseCase(
      clientesRepo,
      agendamentosRepo,
      audit,
    ),
    encerrarAgendamento: new CloseAppointmentUseCase(agendamentosRepo, audit),
    listarAgenda: new ListAgendaUseCase(agendamentosRepo),
  };

  return {
    handle,
    catalogo,
    tokens,
    audit,
    identity,
    crm,
    mcp: new McpCatalog([crmMcpContribution(crm)]),
    tenancy: new TenancyService(resolverAcesso, tenantsRepo),
    signIn: new SignInUseCase(identity, tenantsRepo, resolverAcesso, emissor),
    refreshSession: new RefreshSessionUseCase(
      identity,
      tenantsRepo,
      resolverAcesso,
      emissor,
    ),
    serviceToken: new IssueServiceTokenUseCase(identity, tenantsRepo, emissor),
    entitlements: new ManageEntitlementsUseCase(
      entitlementsRepo,
      audit,
      catalogo.ordered.map((manifest) => manifest.id),
    ),
  };
}
