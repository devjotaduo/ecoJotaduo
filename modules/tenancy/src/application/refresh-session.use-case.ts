import type { IdentityPublicApi } from '@movimentar/identity';

import { TenantNotFoundError } from '../domain/errors';
import type {
  AccessTokenIssuer,
  TenantRepository,
} from '../ports/repositories';

import type { ResolveAccessGrantUseCase } from './resolve-access-grant.use-case';

export interface RefreshedSession {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly permissions: readonly string[];
  readonly entitlements: readonly string[];
}

/**
 * Renova a sessão rotacionando o refresh token.
 *
 * O acesso é resolvido de novo a partir do banco: se o vínculo foi revogado,
 * um papel mudou ou o tenant foi suspenso, a renovação falha ou vem com menos
 * permissões — o token antigo não perpetua privilégio.
 */
export class RefreshSessionUseCase {
  constructor(
    private readonly identity: IdentityPublicApi,
    private readonly tenants: TenantRepository,
    private readonly resolverAcesso: ResolveAccessGrantUseCase,
    private readonly tokens: AccessTokenIssuer,
  ) {}

  async execute(entrada: { refreshToken: string }): Promise<RefreshedSession> {
    const rotacionado = await this.identity.rotateRefreshToken(
      entrada.refreshToken,
    );

    const tenant = await this.tenants.findById(rotacionado.tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(rotacionado.tenantId);
    }

    const acesso = await this.resolverAcesso.execute({
      tenantId: tenant.id,
      userId: rotacionado.userId,
      scopes: ['*'],
    });

    const tokenDeAcesso = this.tokens.issue({
      subject: rotacionado.userId,
      tenantId: tenant.id,
      kind: 'user',
      scopes: ['*'],
    });

    return {
      accessToken: tokenDeAcesso.token,
      accessTokenExpiresAt: tokenDeAcesso.expiresAt,
      refreshToken: rotacionado.refresh.token,
      refreshTokenExpiresAt: rotacionado.refresh.expiresAt,
      permissions: acesso.grant.permissions,
      entitlements: acesso.grant.entitlements,
    };
  }
}
