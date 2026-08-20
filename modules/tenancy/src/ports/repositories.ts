import type { Entitlement, Membership, Tenant } from '../domain/tenant';

export interface TenantSummary {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
}

export interface TenantRepository {
  /**
   * Busca por slug no contexto de um usuário já autenticado.
   *
   * Exige o `userId` porque, no login, ainda não há tenant resolvido: é o
   * vínculo do usuário que autoriza enxergar a empresa. Consequência
   * desejada: pedir uma empresa da qual não se participa é indistinguível de
   * pedir uma empresa que não existe.
   */
  findBySlugForUser(slug: string, userId: string): Promise<Tenant | null>;
  findById(tenantId: string): Promise<Tenant | null>;
  /** Empresas em que o usuário tem vínculo ativo (consulta cross-tenant). */
  listForUser(userId: string): Promise<TenantSummary[]>;
}

export interface MembershipRepository {
  findActive(tenantId: string, userId: string): Promise<Membership | null>;
  /** Permissões efetivas do vínculo, somando todos os papéis. */
  listPermissions(tenantId: string, membershipId: string): Promise<string[]>;
}

export interface EntitlementRepository {
  list(tenantId: string): Promise<Entitlement[]>;
  find(tenantId: string, moduleId: string): Promise<Entitlement | null>;
  grant(input: {
    tenantId: string;
    moduleId: string;
    expiresAt: Date | null;
  }): Promise<void>;
  revoke(tenantId: string, moduleId: string): Promise<void>;
}

/** Emissão do access token — mantém a criptografia fora da camada de aplicação. */
export interface AccessTokenIssuer {
  issue(entrada: {
    subject: string;
    tenantId: string;
    kind: 'user' | 'service';
    scopes: readonly string[];
  }): { token: string; expiresAt: Date };
}
