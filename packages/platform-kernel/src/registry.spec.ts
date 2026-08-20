import { describe, expect, it } from 'vitest';

import type { ModuleManifest } from './manifest';
import { ModuleRegistryError, resolveModules } from './registry';

function manifesto(
  id: string,
  dependeDe: readonly string[] = [],
  permissoes: readonly string[] = [],
): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: `módulo ${id}`,
    dependencies: dependeDe.map((moduleId) => ({
      moduleId,
      versionRange: '^1.0.0',
    })),
    permissions: permissoes.map((key) => ({ key, description: key })),
    events: [],
    minimumPlatformVersion: '1.0.0',
  };
}

describe('resolveModules', () => {
  it('ordena por dependência (a base vem antes de quem depende dela)', () => {
    const resolvido = resolveModules([
      manifesto('tenancy', ['identity']),
      manifesto('identity'),
    ]);

    expect(resolvido.ordered.map((m) => m.id)).toEqual(['identity', 'tenancy']);
  });

  it('resolve cadeias mais longas mantendo a ordem correta', () => {
    const resolvido = resolveModules([
      manifesto('billing', ['contracts']),
      manifesto('contracts', ['commercial']),
      manifesto('commercial', ['crm']),
      manifesto('crm'),
    ]);

    expect(resolvido.ordered.map((m) => m.id)).toEqual([
      'crm',
      'commercial',
      'contracts',
      'billing',
    ]);
  });

  it('recusa dependência ausente', () => {
    expect(() => resolveModules([manifesto('tenancy', ['identity'])])).toThrow(
      /não está carregado/,
    );
  });

  it('recusa ciclo entre módulos', () => {
    expect(() =>
      resolveModules([manifesto('a', ['b']), manifesto('b', ['a'])]),
    ).toThrow(ModuleRegistryError);
  });

  it('recusa módulo duplicado', () => {
    expect(() => resolveModules([manifesto('crm'), manifesto('crm')])).toThrow(
      /duplicado/,
    );
  });

  it('recusa a mesma permissão declarada por dois módulos', () => {
    expect(() =>
      resolveModules([
        manifesto('crm', [], ['crm.customer.read']),
        manifesto('commercial', [], ['crm.customer.read']),
      ]),
    ).toThrow(/declarada por/);
  });

  it('agrega o catálogo de permissões dos módulos', () => {
    const resolvido = resolveModules([
      manifesto('identity', [], ['platform.user.manage']),
      manifesto('tenancy', ['identity'], ['platform.module.manage']),
    ]);

    expect(resolvido.permissions.map((p) => p.key)).toEqual([
      'platform.user.manage',
      'platform.module.manage',
    ]);
  });

  it('deriva as fontes de migração na ordem de dependência', () => {
    const identity: ModuleManifest = {
      ...manifesto('identity'),
      migrations: { packageName: '@movimentar/identity' },
    };
    const tenancy: ModuleManifest = {
      ...manifesto('tenancy', ['identity']),
      migrations: { packageName: '@movimentar/tenancy' },
    };

    const resolvido = resolveModules([tenancy, identity]);

    expect(resolvido.migrationSources).toEqual([
      { moduleId: 'identity', packageName: '@movimentar/identity' },
      { moduleId: 'tenancy', packageName: '@movimentar/tenancy' },
    ]);
  });

  it('permite localizar um módulo pelo id', () => {
    const resolvido = resolveModules([manifesto('crm')]);
    expect(resolvido.byId('crm')?.name).toBe('crm');
    expect(resolvido.byId('inexistente')).toBeUndefined();
  });
});
