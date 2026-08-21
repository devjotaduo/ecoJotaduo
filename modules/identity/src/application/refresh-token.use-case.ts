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
    return this.gravar(randomUUID(), entrada, agora);
  }

  private async gravar(
    id: string,
    entrada: { userId: string; tenantId: string },
    agora: Date,
  ): Promise<IssuedRefreshToken> {
    const token = this.generator.create();
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

    // Revoga ANTES de emitir, e só se ninguém revogou antes. A ordem importa:
    //
    // - revogar primeiro faz a falha ser fechada (o usuário refaz o login) em
    //   vez de aberta (dois refresh tokens válidos saídos de um);
    // - a condição `revoked_at is null` vive no UPDATE, então duas chamadas
    //   simultâneas com o MESMO token têm uma vencedora — a perdedora cai no
    //   ramo de reuso abaixo, que é exatamente o que se quer de um vazamento.
    //
    // O id do substituto é sorteado aqui para poder ser encadeado já na
    // revogação; se a emissão falhar, ele fica apontando para um token que
    // não existe, e isso é informação de investigação, não defeito.
    const novoId = randomUUID();
    const revogou = await this.tokens.revoke(registro.id, novoId);
    if (!revogou) {
      await this.tokens.revokeAllOfUser(registro.userId);
      throw new RefreshTokenInvalidError();
    }

    const novo = await this.gravar(
      novoId,
      { userId: registro.userId, tenantId: registro.tenantId },
      agora,
    );

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
