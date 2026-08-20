import { randomUUID } from 'node:crypto';

import type { Database } from '@ecojotaduo/database';
import { withTenant, withUserOnly } from '@ecojotaduo/database';
import type { TenantId, UserId } from '@ecojotaduo/tenant-context';
import { and, eq, inArray } from 'drizzle-orm';

import type {
  Entitlement,
  EntitlementStatus,
  Membership,
  MembershipStatus,
  TenantStatus,
} from '../../domain/tenant';
import { Tenant } from '../../domain/tenant';
import type {
  EntitlementRepository,
  MembershipRepository,
  TenantRepository,
  TenantSummary,
} from '../../ports/repositories';

import {
  membershipRoles,
  memberships,
  moduleEntitlements,
  rolePermissions,
  tenants,
} from './schema';

/**
 * Repositório de tenants.
 *
 * Toda consulta roda dentro de um escopo — não existe leitura "solta". No
 * login o escopo é o usuário (`withUserOnly`), pois o tenant ainda não foi
 * resolvido; depois disso é sempre o tenant (`withTenant`). Sem escopo, a
 * policy de RLS de `tenancy_tenants` não revela linha nenhuma, que é
 * exatamente o comportamento desejado.
 */
export class DrizzleTenantRepository implements TenantRepository {
  constructor(private readonly db: Database) {}

  async findBySlugForUser(
    slug: string,
    userId: string,
  ): Promise<Tenant | null> {
    return withUserOnly(this.db, userId as UserId, async (tx) => {
      const [linha] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      return linha ? this.paraDominio(linha) : null;
    });
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    return withTenant(
      this.db,
      { tenantId: tenantId as TenantId },
      async (tx) => {
        const [linha] = await tx
          .select()
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        return linha ? this.paraDominio(linha) : null;
      },
    );
  }

  async listForUser(userId: string): Promise<TenantSummary[]> {
    return withUserOnly(this.db, userId as UserId, async (tx) => {
      const linhas = await tx
        .select({
          tenantId: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(
          and(eq(memberships.userId, userId), eq(memberships.status, 'active')),
        );
      return linhas;
    });
  }

  private paraDominio(linha: typeof tenants.$inferSelect): Tenant {
    return Tenant.restore({
      id: linha.id,
      organizationId: linha.organizationId,
      slug: linha.slug,
      name: linha.name,
      status: linha.status as TenantStatus,
    });
  }
}

export class DrizzleMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Database) {}

  async findActive(
    tenantId: string,
    userId: string,
  ): Promise<Membership | null> {
    return withTenant(
      this.db,
      { tenantId: tenantId as TenantId, userId: userId as UserId },
      async (tx) => {
        const [linha] = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, tenantId),
              eq(memberships.userId, userId),
              eq(memberships.status, 'active'),
            ),
          )
          .limit(1);

        return linha
          ? {
              id: linha.id,
              tenantId: linha.tenantId,
              userId: linha.userId,
              status: linha.status as MembershipStatus,
            }
          : null;
      },
    );
  }

  async listPermissions(
    tenantId: string,
    membershipId: string,
  ): Promise<string[]> {
    return withTenant(
      this.db,
      { tenantId: tenantId as TenantId },
      async (tx) => {
        const papeis = await tx
          .select({ roleId: membershipRoles.roleId })
          .from(membershipRoles)
          .where(
            and(
              eq(membershipRoles.membershipId, membershipId),
              eq(membershipRoles.tenantId, tenantId),
            ),
          );

        if (papeis.length === 0) {
          return [];
        }

        const linhas = await tx
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(
            inArray(
              rolePermissions.roleId,
              papeis.map((papel) => papel.roleId),
            ),
          );

        return [...new Set(linhas.map((linha) => linha.permission))];
      },
    );
  }
}

export class DrizzleEntitlementRepository implements EntitlementRepository {
  constructor(private readonly db: Database) {}

  async list(tenantId: string): Promise<Entitlement[]> {
    return withTenant(
      this.db,
      { tenantId: tenantId as TenantId },
      async (tx) => {
        const linhas = await tx
          .select()
          .from(moduleEntitlements)
          .where(eq(moduleEntitlements.tenantId, tenantId));

        return linhas.map((linha) => this.paraDominio(linha));
      },
    );
  }

  async find(tenantId: string, moduleId: string): Promise<Entitlement | null> {
    return withTenant(
      this.db,
      { tenantId: tenantId as TenantId },
      async (tx) => {
        const [linha] = await tx
          .select()
          .from(moduleEntitlements)
          .where(
            and(
              eq(moduleEntitlements.tenantId, tenantId),
              eq(moduleEntitlements.moduleId, moduleId),
            ),
          )
          .limit(1);

        return linha ? this.paraDominio(linha) : null;
      },
    );
  }

  async grant(input: {
    tenantId: string;
    moduleId: string;
    expiresAt: Date | null;
  }): Promise<void> {
    await withTenant(
      this.db,
      { tenantId: input.tenantId as TenantId },
      async (tx) => {
        await tx
          .insert(moduleEntitlements)
          .values({
            id: randomUUID(),
            tenantId: input.tenantId,
            moduleId: input.moduleId,
            status: 'active',
            expiresAt: input.expiresAt,
          })
          .onConflictDoUpdate({
            target: [moduleEntitlements.tenantId, moduleEntitlements.moduleId],
            set: {
              status: 'active',
              expiresAt: input.expiresAt,
              grantedAt: new Date(),
            },
          });
      },
    );
  }

  async revoke(tenantId: string, moduleId: string): Promise<void> {
    await withTenant(
      this.db,
      { tenantId: tenantId as TenantId },
      async (tx) => {
        await tx
          .update(moduleEntitlements)
          .set({ status: 'suspended' })
          .where(
            and(
              eq(moduleEntitlements.tenantId, tenantId),
              eq(moduleEntitlements.moduleId, moduleId),
            ),
          );
      },
    );
  }

  private paraDominio(
    linha: typeof moduleEntitlements.$inferSelect,
  ): Entitlement {
    return {
      moduleId: linha.moduleId,
      status: linha.status as EntitlementStatus,
      expiresAt: linha.expiresAt,
    };
  }
}
