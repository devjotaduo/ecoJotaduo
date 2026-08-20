export * from './contracts/public-api';
export * from './manifest';

export {
  Tenant,
  entitlementIsValid,
  type Entitlement,
  type EntitlementStatus,
  type Membership,
  type MembershipStatus,
  type TenantStatus,
} from './domain/tenant';
export {
  ModuleAlreadyEntitledError,
  NoActiveMembershipError,
  TenantNotActiveError,
  TenantNotFoundError,
  UnknownModuleError,
} from './domain/errors';

export { ResolveAccessGrantUseCase } from './application/resolve-access-grant.use-case';
export { SignInUseCase, type Session } from './application/sign-in.use-case';
export {
  RefreshSessionUseCase,
  type RefreshedSession,
} from './application/refresh-session.use-case';
export {
  IssueServiceTokenUseCase,
  type ServiceToken,
} from './application/issue-service-token.use-case';
export { ManageEntitlementsUseCase } from './application/manage-entitlements.use-case';

export type {
  AccessTokenIssuer,
  EntitlementRepository,
  MembershipRepository,
  TenantRepository,
  TenantSummary,
} from './ports/repositories';

export {
  DrizzleEntitlementRepository,
  DrizzleMembershipRepository,
  DrizzleTenantRepository,
} from './adapters/persistence/repositories';
export {
  membershipRoles,
  memberships,
  moduleEntitlements,
  organizations,
  rolePermissions,
  roles,
  tenants,
} from './adapters/persistence/schema';

export { TenancyService } from './tenancy.service';
