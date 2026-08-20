/**
 * Superfície pública do módulo tenancy — o que outros módulos e os
 * composition roots podem usar.
 */
import type { AccessGrant } from '@ecojotaduo/permissions';

export interface TenantView {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
}

export interface TenancyPublicApi {
  /** Resolve permissões efetivas de um usuário no tenant (chamado por request). */
  resolveUserAccess(entrada: {
    tenantId: string;
    userId: string;
    scopes: readonly string[];
  }): Promise<AccessGrant>;

  resolveServiceAccess(entrada: {
    tenantId: string;
    scopes: readonly string[];
  }): Promise<AccessGrant>;

  listTenantsOfUser(userId: string): Promise<TenantView[]>;
}

export const TENANCY_PUBLIC_API = Symbol.for('ecojotaduo.tenancy.publicApi');
