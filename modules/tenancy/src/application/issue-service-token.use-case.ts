import type { IdentityPublicApi } from '@movimentar/identity';

import { TenantNotFoundError } from '../domain/errors';
import type {
  AccessTokenIssuer,
  TenantRepository,
} from '../ports/repositories';

export interface ServiceToken {
  readonly accessToken: string;
  readonly expiresAt: Date;
  readonly scopes: readonly string[];
  readonly tenantId: string;
}

/**
 * Autenticação de aplicação (client credentials).
 *
 * Sem refresh token: a integração reapresenta client_id/secret quando o
 * access token expira. O tenant vem da própria conta — o cliente não escolhe.
 */
export class IssueServiceTokenUseCase {
  constructor(
    private readonly identity: IdentityPublicApi,
    private readonly tenants: TenantRepository,
    private readonly tokens: AccessTokenIssuer,
  ) {}

  async execute(entrada: {
    clientId: string;
    clientSecret: string;
  }): Promise<ServiceToken> {
    const conta = await this.identity.verifyServiceAccount(entrada);

    const tenant = await this.tenants.findById(conta.tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(conta.tenantId);
    }
    tenant.assertActive();

    const emitido = this.tokens.issue({
      subject: conta.serviceAccountId,
      tenantId: tenant.id,
      kind: 'service',
      scopes: conta.scopes,
    });

    return {
      accessToken: emitido.token,
      expiresAt: emitido.expiresAt,
      scopes: conta.scopes,
      tenantId: tenant.id,
    };
  }
}
