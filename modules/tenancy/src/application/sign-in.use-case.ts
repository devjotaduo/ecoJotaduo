import type { IdentityPublicApi } from '@ecojotaduo/identity';

import { TenantNotFoundError } from '../domain/errors';
import type {
  AccessTokenIssuer,
  TenantRepository,
} from '../ports/repositories';

import type { ResolveAccessGrantUseCase } from './resolve-access-grant.use-case';

export interface Session {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly tenant: { id: string; slug: string; name: string };
  readonly user: { id: string; name: string; email: string };
  readonly permissions: readonly string[];
  readonly entitlements: readonly string[];
}

/**
 * Login em um tenant específico.
 *
 * Fica em tenancy (e não em identity) porque "entrar" exige vínculo, papéis e
 * módulos contratados — identity apenas confirma quem é a pessoa. A direção da
 * dependência (tenancy → identity) segue o mapa de módulos.
 */
export class SignInUseCase {
  constructor(
    private readonly identity: IdentityPublicApi,
    private readonly tenants: TenantRepository,
    private readonly resolverAcesso: ResolveAccessGrantUseCase,
    private readonly tokens: AccessTokenIssuer,
  ) {}

  async execute(entrada: {
    email: string;
    password: string;
    tenantSlug: string;
  }): Promise<Session> {
    // 1. Quem é a pessoa (lança InvalidCredentialsError se não confere).
    const usuario = await this.identity.verifyCredentials({
      email: entrada.email,
      password: entrada.password,
    });

    // 2. Em qual empresa está entrando (só enxerga onde tem vínculo).
    const tenant = await this.tenants.findBySlugForUser(
      entrada.tenantSlug,
      usuario.userId,
    );
    if (!tenant) {
      throw new TenantNotFoundError(entrada.tenantSlug);
    }

    // 3. Vínculo, papéis e módulos contratados.
    const acesso = await this.resolverAcesso.execute({
      tenantId: tenant.id,
      userId: usuario.userId,
      // No login por senha o token recebe escopo total: quem limita é o RBAC.
      scopes: ['*'],
    });

    // 4. Tokens. O tenant fica preso no token — nunca vem de parâmetro depois.
    const tokenDeAcesso = this.tokens.issue({
      subject: usuario.userId,
      tenantId: tenant.id,
      kind: 'user',
      scopes: ['*'],
    });
    const refresh = await this.identity.issueRefreshToken({
      userId: usuario.userId,
      tenantId: tenant.id,
    });

    return {
      accessToken: tokenDeAcesso.token,
      accessTokenExpiresAt: tokenDeAcesso.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      user: { id: usuario.userId, name: usuario.name, email: usuario.email },
      permissions: acesso.grant.permissions,
      entitlements: acesso.grant.entitlements,
    };
  }
}
