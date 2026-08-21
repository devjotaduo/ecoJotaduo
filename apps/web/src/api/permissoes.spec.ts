import { describe, expect, it } from 'vitest';

import { concede, moduloDe, podeNaInterface } from './permissoes';

const comCrm = {
  permissions: ['crm.customer.read', 'crm.customer.create'],
  entitlements: ['crm'],
};

describe('podeNaInterface', () => {
  it('exige permissão do papel E módulo contratado', () => {
    expect(podeNaInterface(comCrm, 'crm.customer.create')).toBe(true);
    // Permissão que o papel não tem.
    expect(podeNaInterface(comCrm, 'crm.customer.update')).toBe(false);
    // Módulo que a empresa não contratou.
    expect(
      podeNaInterface(
        { permissions: ['*'], entitlements: [] },
        'commercial.proposal.read',
      ),
    ).toBe(false);
  });

  it('sem sessão, não mostra nada', () => {
    expect(podeNaInterface(null, 'crm.customer.read')).toBe(false);
  });

  it('`platform.*` não depende de contratação', () => {
    expect(
      podeNaInterface(
        { permissions: ['platform.*'], entitlements: [] },
        'platform.plugin.read',
      ),
    ).toBe(true);
  });

  it('habilitar um plugin não revela os outros', () => {
    // Espelha o recorte de `moduleOf` no servidor: se o módulo fosse só
    // `plugin`, um plugin habilitado mostraria a interface de todos.
    const acesso = {
      permissions: ['*'],
      entitlements: ['plugin.notifications-example'],
    };
    expect(
      podeNaInterface(acesso, 'plugin.notifications-example.message.send'),
    ).toBe(true);
    expect(podeNaInterface(acesso, 'plugin.whatsapp.message.send')).toBe(false);
  });
});

describe('concede', () => {
  it('entende os curingas do motor', () => {
    expect(concede(['*'], 'qualquer.coisa')).toBe(true);
    expect(concede(['crm.*'], 'crm.customer.read')).toBe(true);
    expect(concede(['crm.customer.*'], 'crm.customer.read')).toBe(true);
  });

  it('curinga não atravessa para nome parecido', () => {
    // `crm.*` jamais pode alcançar `crmx.algo`.
    expect(concede(['crm.*'], 'crmx.customer.read')).toBe(false);
    expect(concede(['crm.*'], 'crm')).toBe(false);
  });
});

describe('moduloDe', () => {
  it('usa o primeiro segmento', () => {
    expect(moduloDe('commercial.proposal.read')).toBe('commercial');
  });

  it('capacidade de plugin pertence ao plugin', () => {
    expect(moduloDe('plugin.notifications-example.message.send')).toBe(
      'plugin.notifications-example',
    );
  });
});
