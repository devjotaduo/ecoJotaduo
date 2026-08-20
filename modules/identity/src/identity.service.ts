import type { RefreshTokenUseCase } from './application/refresh-token.use-case';
import type { VerifyCredentialsUseCase } from './application/verify-credentials.use-case';
import type { VerifyServiceAccountUseCase } from './application/verify-service-account.use-case';
import type {
  IdentityPublicApi,
  IdentityRefreshToken,
  IdentityServiceAccountSummary,
  IdentityUserSummary,
} from './contracts/public-api';
import type { UserRepository } from './ports/repositories';

/** Fachada que implementa o contrato público a partir dos casos de uso. */
export class IdentityService implements IdentityPublicApi {
  constructor(
    private readonly verificarCredenciais: VerifyCredentialsUseCase,
    private readonly verificarServiceAccount: VerifyServiceAccountUseCase,
    private readonly refreshTokens: RefreshTokenUseCase,
    private readonly usuarios: UserRepository,
  ) {}

  verifyCredentials(entrada: {
    email: string;
    password: string;
  }): Promise<IdentityUserSummary> {
    return this.verificarCredenciais.execute(entrada);
  }

  verifyServiceAccount(entrada: {
    clientId: string;
    clientSecret: string;
  }): Promise<IdentityServiceAccountSummary> {
    return this.verificarServiceAccount.execute(entrada);
  }

  async findUserById(userId: string): Promise<IdentityUserSummary | null> {
    const usuario = await this.usuarios.findById(userId);
    return usuario
      ? { userId: usuario.id, name: usuario.name, email: usuario.email.value }
      : null;
  }

  issueRefreshToken(entrada: {
    userId: string;
    tenantId: string;
  }): Promise<IdentityRefreshToken> {
    return this.refreshTokens.issue(entrada);
  }

  rotateRefreshToken(token: string): Promise<{
    userId: string;
    tenantId: string;
    refresh: IdentityRefreshToken;
  }> {
    return this.refreshTokens.rotate(token);
  }

  revokeUserSessions(userId: string): Promise<void> {
    return this.refreshTokens.revokeAllOfUser(userId);
  }
}
