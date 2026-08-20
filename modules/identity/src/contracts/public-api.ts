/**
 * Superfície pública do módulo identity.
 *
 * É o ÚNICO ponto de entrada para outros módulos (hoje, tenancy). Ninguém de
 * fora importa `src/**` nem toca nas tabelas `identity_*` diretamente.
 */

export interface IdentityUserSummary {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

export interface IdentityServiceAccountSummary {
  readonly serviceAccountId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: readonly string[];
}

export interface IdentityRefreshToken {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: Date;
}

export interface IdentityPublicApi {
  /** Lança InvalidCredentialsError quando e-mail ou senha não conferem. */
  verifyCredentials(entrada: {
    email: string;
    password: string;
  }): Promise<IdentityUserSummary>;

  verifyServiceAccount(entrada: {
    clientId: string;
    clientSecret: string;
  }): Promise<IdentityServiceAccountSummary>;

  findUserById(userId: string): Promise<IdentityUserSummary | null>;

  issueRefreshToken(entrada: {
    userId: string;
    tenantId: string;
  }): Promise<IdentityRefreshToken>;

  /** Consome o refresh token e emite outro (rotação obrigatória). */
  rotateRefreshToken(token: string): Promise<{
    userId: string;
    tenantId: string;
    refresh: IdentityRefreshToken;
  }>;

  revokeUserSessions(userId: string): Promise<void>;
}

/** Token de injeção usado pelo composition root (evita acoplar em classe). */
export const IDENTITY_PUBLIC_API = Symbol.for('ecojotaduo.identity.publicApi');
