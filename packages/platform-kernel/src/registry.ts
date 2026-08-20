import type { PermissionDefinition } from '@ecojotaduo/permissions';

import type { ModuleManifest } from './manifest';

export class ModuleRegistryError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ModuleRegistryError';
  }
}

export interface MigrationSource {
  readonly moduleId: string;
  readonly packageName: string;
}

export interface ResolvedModules {
  /** Módulos em ordem de dependência — também é a ordem das migrações. */
  readonly ordered: readonly ModuleManifest[];
  readonly permissions: readonly PermissionDefinition[];
  readonly migrationSources: readonly MigrationSource[];
  byId(moduleId: string): ModuleManifest | undefined;
}

/**
 * Valida o conjunto de módulos e devolve a ordem topológica de carga.
 *
 * Recusa: id duplicado, dependência ausente, permissão declarada por dois
 * módulos e ciclo de dependências. Como a ordem das migrações sai daqui,
 * um ciclo entre módulos vira erro de boot em vez de bug de schema.
 */
export function resolveModules(
  manifests: readonly ModuleManifest[],
): ResolvedModules {
  const porId = new Map<string, ModuleManifest>();
  for (const manifest of manifests) {
    if (porId.has(manifest.id)) {
      throw new ModuleRegistryError(`Módulo duplicado: "${manifest.id}".`);
    }
    porId.set(manifest.id, manifest);
  }

  for (const manifest of manifests) {
    for (const dependencia of manifest.dependencies) {
      if (!porId.has(dependencia.moduleId)) {
        throw new ModuleRegistryError(
          `Módulo "${manifest.id}" depende de "${dependencia.moduleId}", que não está carregado.`,
        );
      }
    }
  }

  const ordered: ModuleManifest[] = [];
  const estado = new Map<string, 'visitando' | 'pronto'>();

  const visitar = (
    manifest: ModuleManifest,
    caminho: readonly string[],
  ): void => {
    const atual = estado.get(manifest.id);
    if (atual === 'pronto') return;
    if (atual === 'visitando') {
      throw new ModuleRegistryError(
        `Ciclo de dependências entre módulos: ${[...caminho, manifest.id].join(' → ')}.`,
      );
    }

    estado.set(manifest.id, 'visitando');
    for (const dependencia of manifest.dependencies) {
      const alvo = porId.get(dependencia.moduleId);
      if (alvo) {
        visitar(alvo, [...caminho, manifest.id]);
      }
    }
    estado.set(manifest.id, 'pronto');
    ordered.push(manifest);
  };

  for (const manifest of manifests) {
    visitar(manifest, []);
  }

  const permissions: PermissionDefinition[] = [];
  const donoDaPermissao = new Map<string, string>();
  for (const manifest of ordered) {
    for (const permission of manifest.permissions) {
      const dono = donoDaPermissao.get(permission.key);
      if (dono) {
        throw new ModuleRegistryError(
          `Permissão "${permission.key}" declarada por "${dono}" e por "${manifest.id}".`,
        );
      }
      donoDaPermissao.set(permission.key, manifest.id);
      permissions.push(permission);
    }
  }

  const migrationSources = ordered.flatMap((manifest) =>
    manifest.migrations
      ? [
          {
            moduleId: manifest.id,
            packageName: manifest.migrations.packageName,
          },
        ]
      : [],
  );

  return {
    ordered,
    permissions,
    migrationSources,
    byId: (moduleId) => porId.get(moduleId),
  };
}
