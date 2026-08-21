import type { User } from '../domain/user';

export interface ServiceAccountRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly clientId: string;
  readonly secretHash: string;
  readonly scopes: readonly string[];
  readonly status: 'active' | 'disabled';
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface PersonalAccessTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly hint: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

export interface PersonalAccessTokenRepository {
  save(entrada: {
    id: string;
    userId: string;
    tenantId: string;
    name: string;
    tokenHash: string;
    hint: string;
    scopes: readonly string[];
    expiresAt: Date | null;
    createdAt: Date;
  }): Promise<void>;
  findByHash(tokenHash: string): Promise<PersonalAccessTokenRecord | null>;
  listOfUser(
    userId: string,
    tenantId: string,
  ): Promise<PersonalAccessTokenRecord[]>;
  /** `false` quando o token não é desta pessoa nesta empresa, ou já foi revogado. */
  revoke(
    tokenId: string,
    userId: string,
    tenantId: string,
    agora: Date,
  ): Promise<boolean>;
  markUsed(tokenId: string, agora: Date): Promise<void>;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

export interface ServiceAccountRepository {
  findByClientId(clientId: string): Promise<ServiceAccountRecord | null>;
}

export interface RefreshTokenRepository {
  save(input: {
    id: string;
    userId: string;
    tenantId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /**
   * Marca como usado e aponta para o token que o substituiu (rotação).
   *
   * Devolve `false` quando a linha JÁ estava revogada — é o que transforma
   * duas rotações concorrentes do mesmo token em uma vencedora e uma
   * detecção de reuso. A condição tem de ser avaliada pelo armazenamento,
   * não pelo chamador: ler-e-depois-escrever deixa a janela aberta.
   */
  revoke(id: string, substitutoId: string | null): Promise<boolean>;
  revokeAllOfUser(userId: string): Promise<void>;
}

/** O domínio não escolhe algoritmo de hash — só declara o que precisa. */
export interface PasswordHasher {
  verify(senha: string, hash: string): Promise<boolean>;
  hash(senha: string): Promise<string>;
}

export interface SecretHasher {
  hash(segredo: string): string;
  matches(segredo: string, hash: string): boolean;
}
