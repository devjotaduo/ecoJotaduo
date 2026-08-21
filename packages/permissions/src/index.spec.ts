import { describe, expect, it } from 'vitest';

import {
  assertAllowed,
  authorize,
  ForbiddenError,
  moduleOf,
  permissionMatches,
  pluginEntitlement,
  type AccessGrant,
} from './index';

const completo: AccessGrant = {
  permissions: ['*'],
  scopes: ['*'],
  entitlements: ['crm', 'finance'],
};

describe('permissionMatches', () => {
  it('casa exato e curinga total', () => {
    expect(permissionMatches('crm.customer.read', 'crm.customer.read')).toBe(
      true,
    );
    expect(permissionMatches('*', 'finance.payment.approve')).toBe(true);
  });

  it('casa curinga por módulo e por recurso', () => {
    expect(permissionMatches('crm.*', 'crm.customer.read')).toBe(true);
    expect(permissionMatches('crm.customer.*', 'crm.customer.update')).toBe(
      true,
    );
  });

  it('não deixa curinga vazar para módulo de nome parecido', () => {
    expect(permissionMatches('crm.*', 'crmx.customer.read')).toBe(false);
    expect(permissionMatches('crm.*', 'crm')).toBe(false);
    expect(permissionMatches('crm.customer.*', 'crm.contact.read')).toBe(false);
  });

  it('não aceita curinga no meio do padrão', () => {
    expect(permissionMatches('crm.*.read', 'crm.customer.read')).toBe(false);
  });
});

describe('authorize', () => {
  it('permite quando módulo, papel e escopo concedem', () => {
    expect(authorize(completo, 'crm.customer.read')).toEqual({ allowed: true });
  });

  it('nega quando o tenant não contratou o módulo', () => {
    const decisao = authorize(completo, 'operations.rental.create');
    expect(decisao).toMatchObject({
      allowed: false,
      reason: 'entitlement',
      moduleId: 'operations',
    });
  });

  it('permissões de plataforma não exigem contratação', () => {
    const grant: AccessGrant = {
      permissions: ['platform.module.manage'],
      scopes: ['*'],
      entitlements: [],
    };
    expect(authorize(grant, 'platform.module.manage')).toEqual({
      allowed: true,
    });
  });

  it('nega quando o papel não concede', () => {
    const grant: AccessGrant = {
      permissions: ['crm.customer.read'],
      scopes: ['*'],
      entitlements: ['crm'],
    };
    expect(authorize(grant, 'crm.customer.create')).toMatchObject({
      allowed: false,
      reason: 'permission',
    });
  });

  it('escopo do token limita o que o papel concede', () => {
    const grant: AccessGrant = {
      permissions: ['*'],
      scopes: ['crm.customer.read'],
      entitlements: ['crm'],
    };
    expect(authorize(grant, 'crm.customer.read')).toEqual({ allowed: true });
    expect(authorize(grant, 'crm.customer.create')).toMatchObject({
      allowed: false,
      reason: 'scope',
    });
  });

  it('a contratação é verificada antes do papel (não vaza existência do módulo)', () => {
    const grant: AccessGrant = {
      permissions: [],
      scopes: [],
      entitlements: [],
    };
    expect(authorize(grant, 'finance.payment.approve')).toMatchObject({
      reason: 'entitlement',
    });
  });

  it('grant vazio nega tudo', () => {
    const vazio: AccessGrant = {
      permissions: [],
      scopes: [],
      entitlements: ['crm'],
    };
    expect(authorize(vazio, 'crm.customer.read').allowed).toBe(false);
  });
});

describe('assertAllowed', () => {
  it('lança ForbiddenError com motivo e módulo', () => {
    const grant: AccessGrant = {
      permissions: [],
      scopes: [],
      entitlements: [],
    };
    try {
      assertAllowed(grant, 'crm.customer.read');
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(ForbiddenError);
      expect((erro as ForbiddenError).reason).toBe('entitlement');
      expect((erro as ForbiddenError).moduleId).toBe('crm');
    }
  });

  it('não lança quando permitido', () => {
    expect(() => assertAllowed(completo, 'crm.customer.read')).not.toThrow();
  });
});

describe('moduleOf', () => {
  it('extrai o primeiro segmento', () => {
    expect(moduleOf('crm.customer.read')).toBe('crm');
    expect(moduleOf('platform')).toBe('platform');
  });

  it('capacidade de plugin pertence ao plugin, não ao prefixo', () => {
    expect(moduleOf('plugin.notifications-example.message.send')).toBe(
      'plugin.notifications-example',
    );
  });
});

describe('capacidades de plugin', () => {
  const comUmPlugin: AccessGrant = {
    permissions: ['*'],
    scopes: ['*'],
    entitlements: ['plugin.notifications-example'],
  };

  it('habilitar um plugin não libera os outros', () => {
    // Sem o recorte de `moduleOf`, o entitlement seria `plugin` e este
    // segundo plugin passaria de carona.
    expect(
      authorize(comUmPlugin, 'plugin.notifications-example.message.send')
        .allowed,
    ).toBe(true);
    const negado = authorize(comUmPlugin, 'plugin.whatsapp.message.send');
    expect(negado.allowed).toBe(false);
    expect(negado.allowed === false && negado.reason).toBe('entitlement');
  });

  it('o papel ainda precisa conceder a permissão da capacidade', () => {
    const semPapel: AccessGrant = { ...comUmPlugin, permissions: ['crm.*'] };
    const negado = authorize(
      semPapel,
      'plugin.notifications-example.message.send',
    );
    expect(negado.allowed === false && negado.reason).toBe('permission');
  });

  it('pluginEntitlement casa com o módulo derivado da permissão', () => {
    expect(pluginEntitlement('notifications-example')).toBe(
      moduleOf('plugin.notifications-example.message.send'),
    );
  });
});
