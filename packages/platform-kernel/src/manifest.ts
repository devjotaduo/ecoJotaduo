import type { PermissionDefinition } from '@movimentar/permissions';

export interface ModuleDependency {
  readonly moduleId: string;
  /** Reservado para o registry de plugins (Fase 6), onde versões de terceiros importam. */
  readonly versionRange: string;
}

export interface EventDefinition {
  /** Nome versionado no passado, ex.: `crm.customer.created.v1`. */
  readonly type: string;
  readonly description: string;
}

/**
 * O manifesto é dado puro: declara o PACOTE dono das migrações, nunca um
 * caminho de disco. Quem resolve o caminho é o composition root, que sabe
 * como o processo foi carregado.
 */
export interface MigrationContribution {
  readonly packageName: string;
}

export interface ModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies: readonly ModuleDependency[];
  readonly permissions: readonly PermissionDefinition[];
  readonly events: readonly EventDefinition[];
  readonly minimumPlatformVersion: string;
  readonly migrations?: MigrationContribution;
}

export type ModuleHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ModuleHealth {
  readonly status: ModuleHealthStatus;
  readonly detail?: string;
}

export interface PlatformModule {
  readonly manifest: ModuleManifest;
  healthCheck?(): Promise<ModuleHealth>;
}
