import type { AuditLogger } from '@movimentar/audit';

import { entitlementIsValid, type Entitlement } from '../domain/tenant';
import {
  ModuleAlreadyEntitledError,
  UnknownModuleError,
} from '../domain/errors';
import type { EntitlementRepository } from '../ports/repositories';

/**
 * Contratação de módulos por tenant.
 *
 * A autorização (`platform.module.manage`) é aplicada pelo guard antes de
 * chegar aqui; estes casos de uso cuidam da regra e da trilha de auditoria.
 */
export class ManageEntitlementsUseCase {
  constructor(
    private readonly entitlements: EntitlementRepository,
    private readonly audit: AuditLogger,
    /** Módulos que existem na instalação — evita contratar nome inventado. */
    private readonly modulosConhecidos: readonly string[],
  ) {}

  async list(
    tenantId: string,
    agora: Date = new Date(),
  ): Promise<Entitlement[]> {
    const todos = await this.entitlements.list(tenantId);
    return todos.filter((entitlement) =>
      entitlementIsValid(entitlement, agora),
    );
  }

  async grant(entrada: {
    tenantId: string;
    moduleId: string;
    expiresAt?: Date | null;
  }): Promise<void> {
    if (!this.modulosConhecidos.includes(entrada.moduleId)) {
      throw new UnknownModuleError(entrada.moduleId);
    }

    const existente = await this.entitlements.find(
      entrada.tenantId,
      entrada.moduleId,
    );
    if (existente && entitlementIsValid(existente)) {
      throw new ModuleAlreadyEntitledError(entrada.moduleId);
    }

    await this.entitlements.grant({
      tenantId: entrada.tenantId,
      moduleId: entrada.moduleId,
      expiresAt: entrada.expiresAt ?? null,
    });

    await this.audit.record({
      action: 'tenancy.module.granted',
      result: 'success',
      resourceType: 'module',
      resourceId: entrada.moduleId,
    });
  }

  async revoke(entrada: { tenantId: string; moduleId: string }): Promise<void> {
    await this.entitlements.revoke(entrada.tenantId, entrada.moduleId);

    await this.audit.record({
      action: 'tenancy.module.revoked',
      result: 'success',
      resourceType: 'module',
      resourceId: entrada.moduleId,
    });
  }
}
