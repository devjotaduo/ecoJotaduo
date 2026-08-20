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
import { createDatabase, type DatabaseHandle } from '@ecojotaduo/database';
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
 * Este é o coração do composition root: nenhuma regra de negócio aqui, só a
 * ligação entre adaptadores concretos e casos de uso. O MCP gateway e o worker
 * chamarão esta mesma função — é o que garante regra de negócio única.
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

  return {
    handle,
    catalogo,
    tokens,
    audit,
    identity,
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
