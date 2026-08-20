import type { AccessGrant } from '@ecojotaduo/permissions';

import { entitlementIsValid } from '../domain/tenant';
import { NoActiveMembershipError, TenantNotFoundError } from '../domain/errors';
import type {
  EntitlementRepository,
  MembershipRepository,
  TenantRepository,
} from '../ports/repositories';

export interface ResolvedAccess {
  readonly grant: AccessGrant;
  readonly membershipId: string;
  readonly tenantName: string;
}

/**
 * Monta o conjunto efetivo de acesso de um usuário dentro de um tenant.
 *
 * Roda a CADA requisição (o guard da API chama antes do caso de uso), então
 * revogar um papel ou suspender um vínculo tem efeito imediato — não fica
 * esperando o access token expirar.
 */
export class ResolveAccessGrantUseCase {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly memberships: MembershipRepository,
    private readonly entitlements: EntitlementRepository,
  ) {}

  async execute(entrada: {
    tenantId: string;
    userId: string;
    scopes: readonly string[];
    agora?: Date;
  }): Promise<ResolvedAccess> {
    const tenant = await this.tenants.findById(entrada.tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(entrada.tenantId);
    }
    tenant.assertActive();

    const membership = await this.memberships.findActive(
      tenant.id,
      entrada.userId,
    );
    if (!membership) {
      throw new NoActiveMembershipError();
    }

    const [permissions, entitlements] = await Promise.all([
      this.memberships.listPermissions(tenant.id, membership.id),
      this.entitlements.list(tenant.id),
    ]);

    const agora = entrada.agora ?? new Date();

    return {
      grant: {
        permissions,
        scopes: entrada.scopes,
        entitlements: entitlements
          .filter((entitlement) => entitlementIsValid(entitlement, agora))
          .map((entitlement) => entitlement.moduleId),
      },
      membershipId: membership.id,
      tenantName: tenant.name,
    };
  }

  /**
   * Service accounts não têm papéis: os escopos concedidos na criação da conta
   * SÃO as permissões, ainda limitadas pelos módulos contratados.
   */
  async executeForServiceAccount(entrada: {
    tenantId: string;
    scopes: readonly string[];
    agora?: Date;
  }): Promise<AccessGrant> {
    const tenant = await this.tenants.findById(entrada.tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(entrada.tenantId);
    }
    tenant.assertActive();

    const entitlements = await this.entitlements.list(tenant.id);
    const agora = entrada.agora ?? new Date();

    return {
      permissions: entrada.scopes,
      scopes: entrada.scopes,
      entitlements: entitlements
        .filter((entitlement) => entitlementIsValid(entitlement, agora))
        .map((entitlement) => entitlement.moduleId),
    };
  }
}
