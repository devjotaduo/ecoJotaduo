import type { AccessGrant } from '@ecojotaduo/permissions';

import type { ResolveAccessGrantUseCase } from './application/resolve-access-grant.use-case';
import type { TenancyPublicApi, TenantView } from './contracts/public-api';
import type { TenantRepository } from './ports/repositories';

export class TenancyService implements TenancyPublicApi {
  constructor(
    private readonly resolverAcesso: ResolveAccessGrantUseCase,
    private readonly tenants: TenantRepository,
  ) {}

  async resolveUserAccess(entrada: {
    tenantId: string;
    userId: string;
    scopes: readonly string[];
  }): Promise<AccessGrant> {
    const resolvido = await this.resolverAcesso.execute(entrada);
    return resolvido.grant;
  }

  resolveServiceAccess(entrada: {
    tenantId: string;
    scopes: readonly string[];
  }): Promise<AccessGrant> {
    return this.resolverAcesso.executeForServiceAccount(entrada);
  }

  listTenantsOfUser(userId: string): Promise<TenantView[]> {
    return this.tenants.listForUser(userId);
  }
}
