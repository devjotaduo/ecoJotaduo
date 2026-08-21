import type { Database } from '@ecojotaduo/database';
import { withTenant } from '@ecojotaduo/database';
import type { PluginStatus } from '@ecojotaduo/plugin-sdk';
import type { TenantId } from '@ecojotaduo/tenant-context';
import { and, eq } from 'drizzle-orm';

import { PluginInstallation } from '../../domain/installation';
import type {
  PluginInstallationRepository,
  PluginSecretRepository,
} from '../../ports/repositories';

import { pluginInstallations, pluginSecrets } from './schema';

const escopo = (tenantId: string) => ({ tenantId: tenantId as TenantId });

export class DrizzlePluginInstallationRepository implements PluginInstallationRepository {
  constructor(private readonly db: Database) {}

  async find(
    tenantId: string,
    pluginId: string,
  ): Promise<PluginInstallation | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(pluginInstallations)
        .where(
          and(
            eq(pluginInstallations.tenantId, tenantId),
            eq(pluginInstallations.pluginId, pluginId),
          ),
        )
        .limit(1);
      return linha ? paraDominio(linha) : null;
    });
  }

  async list(tenantId: string): Promise<PluginInstallation[]> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const linhas = await tx
        .select()
        .from(pluginInstallations)
        .where(eq(pluginInstallations.tenantId, tenantId));
      return linhas.map(paraDominio);
    });
  }

  async listEnabledIds(tenantId: string): Promise<string[]> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const linhas = await tx
        .select({ pluginId: pluginInstallations.pluginId })
        .from(pluginInstallations)
        .where(
          and(
            eq(pluginInstallations.tenantId, tenantId),
            eq(pluginInstallations.status, 'enabled'),
          ),
        );
      return linhas.map((linha) => linha.pluginId);
    });
  }

  async save(instalacao: PluginInstallation): Promise<void> {
    await withTenant(this.db, escopo(instalacao.tenantId), async (tx) => {
      await tx
        .insert(pluginInstallations)
        .values({
          id: instalacao.id,
          tenantId: instalacao.tenantId,
          pluginId: instalacao.pluginId,
          version: instalacao.version,
          status: instalacao.status,
          config: instalacao.config,
          grantedPermissions: [...instalacao.grantedPermissions],
          installedAt: instalacao.installedAt,
          updatedAt: instalacao.updatedAt,
        })
        .onConflictDoUpdate({
          target: pluginInstallations.id,
          set: {
            version: instalacao.version,
            status: instalacao.status,
            config: instalacao.config,
            grantedPermissions: [...instalacao.grantedPermissions],
            updatedAt: instalacao.updatedAt,
          },
        });
    });
  }

  async remove(tenantId: string, pluginId: string): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .delete(pluginInstallations)
        .where(
          and(
            eq(pluginInstallations.tenantId, tenantId),
            eq(pluginInstallations.pluginId, pluginId),
          ),
        );
    });
  }
}

export class DrizzlePluginSecretRepository implements PluginSecretRepository {
  constructor(private readonly db: Database) {}

  async listKeys(tenantId: string, pluginId: string): Promise<string[]> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const linhas = await tx
        .select({ key: pluginSecrets.key })
        .from(pluginSecrets)
        .where(
          and(
            eq(pluginSecrets.tenantId, tenantId),
            eq(pluginSecrets.pluginId, pluginId),
          ),
        );
      return linhas.map((linha) => linha.key);
    });
  }

  async findSealed(
    tenantId: string,
    pluginId: string,
    key: string,
  ): Promise<string | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select({ sealedValue: pluginSecrets.sealedValue })
        .from(pluginSecrets)
        .where(
          and(
            eq(pluginSecrets.tenantId, tenantId),
            eq(pluginSecrets.pluginId, pluginId),
            eq(pluginSecrets.key, key),
          ),
        )
        .limit(1);
      return linha?.sealedValue ?? null;
    });
  }

  async put(entrada: {
    tenantId: string;
    pluginId: string;
    key: string;
    sealedValue: string;
  }): Promise<void> {
    const agora = new Date();
    await withTenant(this.db, escopo(entrada.tenantId), async (tx) => {
      await tx
        .insert(pluginSecrets)
        .values({ ...entrada, createdAt: agora, updatedAt: agora })
        .onConflictDoUpdate({
          target: [
            pluginSecrets.tenantId,
            pluginSecrets.pluginId,
            pluginSecrets.key,
          ],
          set: { sealedValue: entrada.sealedValue, updatedAt: agora },
        });
    });
  }

  async removeAll(tenantId: string, pluginId: string): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .delete(pluginSecrets)
        .where(
          and(
            eq(pluginSecrets.tenantId, tenantId),
            eq(pluginSecrets.pluginId, pluginId),
          ),
        );
    });
  }
}

function paraDominio(linha: {
  id: string;
  tenantId: string;
  pluginId: string;
  version: string;
  status: string;
  config: unknown;
  grantedPermissions: string[];
  installedAt: Date;
  updatedAt: Date;
}): PluginInstallation {
  return PluginInstallation.restore({
    id: linha.id,
    tenantId: linha.tenantId,
    pluginId: linha.pluginId,
    version: linha.version,
    status: linha.status as PluginStatus,
    config: (linha.config as Record<string, unknown>) ?? {},
    grantedPermissions: linha.grantedPermissions,
    installedAt: linha.installedAt,
    updatedAt: linha.updatedAt,
  });
}
