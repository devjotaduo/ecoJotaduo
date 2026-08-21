import type { Database } from '@ecojotaduo/database';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { Email } from '../../domain/email';
import { User, type UserStatus } from '../../domain/user';
import type {
  PersonalAccessTokenRecord,
  PersonalAccessTokenRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  ServiceAccountRecord,
  ServiceAccountRepository,
  UserRepository,
} from '../../ports/repositories';

import {
  personalAccessTokens,
  refreshTokens,
  serviceAccounts,
  users,
} from './schema';

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

/**
 * Tokens pessoais.
 *
 * Tabela de plataforma, como as outras do identity: sem `withTenant`, porque a
 * autenticação acontece ANTES de qualquer empresa ser resolvida. O isolamento
 * aqui vem das próprias cláusulas — toda leitura e escrita filtra por
 * `(user_id, tenant_id)`, e a autenticação é por hash único.
 */
export class DrizzlePersonalAccessTokenRepository implements PersonalAccessTokenRepository {
  constructor(private readonly db: Database) {}

  async save(entrada: {
    id: string;
    userId: string;
    tenantId: string;
    name: string;
    tokenHash: string;
    hint: string;
    scopes: readonly string[];
    expiresAt: Date | null;
    createdAt: Date;
  }): Promise<void> {
    await this.db.insert(personalAccessTokens).values({
      ...entrada,
      scopes: [...entrada.scopes],
    });
  }

  async findByHash(
    tokenHash: string,
  ): Promise<PersonalAccessTokenRecord | null> {
    const [linha] = await this.db
      .select()
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.tokenHash, tokenHash))
      .limit(1);
    return linha ? paraRegistroDeToken(linha) : null;
  }

  async listOfUser(
    userId: string,
    tenantId: string,
  ): Promise<PersonalAccessTokenRecord[]> {
    const linhas = await this.db
      .select()
      .from(personalAccessTokens)
      .where(
        and(
          eq(personalAccessTokens.userId, userId),
          eq(personalAccessTokens.tenantId, tenantId),
          isNull(personalAccessTokens.revokedAt),
        ),
      )
      .orderBy(desc(personalAccessTokens.createdAt));
    return linhas.map(paraRegistroDeToken);
  }

  async revoke(
    tokenId: string,
    userId: string,
    tenantId: string,
    agora: Date,
  ): Promise<boolean> {
    // O `where` inclui o dono: adivinhar o id de um token alheio não revoga
    // nada. E `revoked_at is null` faz revogar duas vezes ser inofensivo.
    const afetadas = await this.db
      .update(personalAccessTokens)
      .set({ revokedAt: agora })
      .where(
        and(
          eq(personalAccessTokens.id, tokenId),
          eq(personalAccessTokens.userId, userId),
          eq(personalAccessTokens.tenantId, tenantId),
          isNull(personalAccessTokens.revokedAt),
        ),
      )
      .returning({ id: personalAccessTokens.id });
    return afetadas.length > 0;
  }

  async markUsed(tokenId: string, agora: Date): Promise<void> {
    await this.db
      .update(personalAccessTokens)
      .set({ lastUsedAt: agora })
      .where(eq(personalAccessTokens.id, tokenId));
  }
}

function paraRegistroDeToken(
  linha: typeof personalAccessTokens.$inferSelect,
): PersonalAccessTokenRecord {
  return {
    id: linha.id,
    userId: linha.userId,
    tenantId: linha.tenantId,
    name: linha.name,
    hint: linha.hint,
    scopes: linha.scopes,
    expiresAt: linha.expiresAt,
    revokedAt: linha.revokedAt,
    lastUsedAt: linha.lastUsedAt,
    createdAt: linha.createdAt,
  };
}
