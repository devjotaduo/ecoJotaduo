import { randomUUID } from 'node:crypto';

import type {
  RefreshTokenRepository,
  SecretHasher,
} from '../ports/repositories';

export class RefreshTokenInvalidError extends Error {
  constructor() {
    super('Refresh token inválido ou expirado.');
    this.name = 'RefreshTokenInvalidError';
  }
}

export interface IssuedRefreshToken {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: Date;
}

export interface RefreshTokenGenerator {
  create(): string;
}

/**
 * Emissão e rotação de refresh tokens.
 *
 * Regra de segurança: cada uso invalida o token anterior (rotação). Se um
 * token já revogado for apresentado de novo, isso indica vazamento — a
 * família inteira do usuário é revogada, forçando novo login.
 */
export class RefreshTokenUseCase {
  constructor(
    private readonly tokens: RefreshTokenRepository,
    private readonly hasher: SecretHasher,
    private readonly generator: RefreshTokenGenerator,
    private readonly ttlDays: number,
  ) {}

  async issue(
    entrada: { userId: string; tenantId: string },
    agora: Date = new Date(),
  ): Promise<IssuedRefreshToken> {
    const token = this.generator.create();
    const id = randomUUID();
    const expiresAt = new Date(agora.getTime() + this.ttlDays * 86_400_000);

    await this.tokens.save({
      id,
      userId: entrada.userId,
      tenantId: entrada.tenantId,
      tokenHash: this.hasher.hash(token),
      expiresAt,
    });

    return { id, token, expiresAt };
  }

  /** Consome o token apresentado e devolve outro; nunca reaproveita o mesmo. */
  async rotate(
    token: string,
    agora: Date = new Date(),
  ): Promise<{
    userId: string;
    tenantId: string;
    refresh: IssuedRefreshToken;
  }> {
    const registro = await this.tokens.findByHash(this.hasher.hash(token));
    if (!registro) {
      throw new RefreshTokenInvalidError();
    }

    if (registro.revokedAt) {
      // Reuso de token já rotacionado: trata como comprometimento.
      await this.tokens.revokeAllOfUser(registro.userId);
      throw new RefreshTokenInvalidError();
    }

    if (registro.expiresAt.getTime() <= agora.getTime()) {
      throw new RefreshTokenInvalidError();
    }

    const novo = await this.issue(
      { userId: registro.userId, tenantId: registro.tenantId },
      agora,
    );
    // Encadeia a substituição: a trilha permite investigar um vazamento.
    await this.tokens.revoke(registro.id, novo.id);

    return {
      userId: registro.userId,
      tenantId: registro.tenantId,
      refresh: novo,
    };
  }

  async revokeAllOfUser(userId: string): Promise<void> {
    await this.tokens.revokeAllOfUser(userId);
  }
}
