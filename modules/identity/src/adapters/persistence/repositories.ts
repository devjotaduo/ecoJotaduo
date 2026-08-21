import type { Database } from '@ecojotaduo/database';
import { eq, isNull, and } from 'drizzle-orm';

import { Email } from '../../domain/email';
import { User, type UserStatus } from '../../domain/user';
import type {
  RefreshTokenRecord,
  RefreshTokenRepository,
  ServiceAccountRecord,
  ServiceAccountRepository,
  UserRepository,
} from '../../ports/repositories';

import { refreshTokens, serviceAccounts, users } from './schema';

/**
 * `identity_users` é tabela de PLATAFORMA (global), não de tenant: o login
 * acontece antes de qualquer tenant estar resolvido, e o mesmo usuário pode
 * pertencer a várias empresas. Por isso estes repositórios não usam
 * `withTenant` — e por isso a tabela não guarda dado de negócio.
 */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findByEmail(email: string): Promise<User | null> {
    const [linha] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return linha ? this.paraDominio(linha) : null;
  }

  async findById(id: string): Promise<User | null> {
    const [linha] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return linha ? this.paraDominio(linha) : null;
  }

  private paraDominio(linha: typeof users.$inferSelect): User {
    return User.restore({
      id: linha.id,
      email: Email.create(linha.email),
      name: linha.name,
      status: linha.status as UserStatus,
      passwordHash: linha.passwordHash,
    });
  }
}

export class DrizzleServiceAccountRepository implements ServiceAccountRepository {
  constructor(private readonly db: Database) {}

  async findByClientId(clientId: string): Promise<ServiceAccountRecord | null> {
    const [linha] = await this.db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.clientId, clientId))
      .limit(1);

    if (!linha) return null;

    return {
      id: linha.id,
      tenantId: linha.tenantId,
      name: linha.name,
      clientId: linha.clientId,
      secretHash: linha.secretHash,
      scopes: linha.scopes,
      status: linha.status as ServiceAccountRecord['status'],
    };
  }
}

export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: Database) {}

  async save(input: {
    id: string;
    userId: string;
    tenantId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(refreshTokens).values(input);
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const [linha] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!linha) return null;

    return {
      id: linha.id,
      userId: linha.userId,
      tenantId: linha.tenantId,
      expiresAt: linha.expiresAt,
      revokedAt: linha.revokedAt,
    };
  }

  async revoke(id: string, substitutoId: string | null): Promise<boolean> {
    // `revoked_at is null` no WHERE: o UPDATE trava a linha e reavalia a
    // condição, então de duas rotações simultâneas exatamente uma afeta a
    // linha. Sem isso, ambas passariam e a detecção de reuso nunca dispararia.
    const afetadas = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedById: substitutoId })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return afetadas.length > 0;
  }

  async revokeAllOfUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }
}
