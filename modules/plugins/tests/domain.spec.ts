import { describe, expect, it } from 'vitest';

import {
  assertPermissoesPedidas,
  PermissaoNaoPedidaError,
  PluginInstallation,
  TransicaoDePluginInvalidaError,
} from '../src/index';

const base = {
  id: '33333333-3333-4333-8333-333333333333',
  tenantId: '11111111-1111-4111-8111-111111111111',
  pluginId: 'notifications-example',
  version: '1.0.0',
  grantedPermissions: ['crm.customer.read'],
};

function instalado() {
  return PluginInstallation.install(base);
}

describe('ciclo de vida da instalação', () => {
  it('nasce apenas instalado', () => {
    expect(instalado().status).toBe('installed');
    expect(instalado().habilitado).toBe(false);
  });

  it('não habilita o que ainda não foi configurado', () => {
    // Habilitar sem configuração deixaria o plugin quebrar dentro de um fluxo
    // de negócio, e não na hora em que alguém clicou "habilitar".
    expect(() =>
      instalado().enable({ segredosExigidos: [], segredosPresentes: [] }),
    ).toThrow(TransicaoDePluginInvalidaError);
  });

  it('não habilita sem os segredos exigidos, e diz quais faltam', () => {
    const instalacao = instalado();
    instalacao.configure({ webhookUrl: 'https://destino.test/hook' });

    expect(() =>
      instalacao.enable({
        segredosExigidos: ['signingSecret'],
        segredosPresentes: [],
      }),
    ).toThrow(/signingSecret/);
  });

  it('configura e habilita', () => {
    const instalacao = instalado();
    instalacao.configure({ webhookUrl: 'https://destino.test/hook' });
    expect(instalacao.status).toBe('configured');

    instalacao.enable({
      segredosExigidos: ['signingSecret'],
      segredosPresentes: ['signingSecret'],
    });
    expect(instalacao.habilitado).toBe(true);
  });

  it('reconfigurar um plugin habilitado NÃO o derruba', () => {
    // Trocar a URL de destino é rotina; desabilitar em silêncio
    // interromperia a integração sem ninguém ter pedido.
    const instalacao = instalado();
    instalacao.configure({ webhookUrl: 'https://a.test/hook' });
    instalacao.enable({
      segredosExigidos: [],
      segredosPresentes: [],
    });

    instalacao.configure({ webhookUrl: 'https://b.test/hook' });
    expect(instalacao.status).toBe('enabled');
    expect(instalacao.config).toEqual({ webhookUrl: 'https://b.test/hook' });
  });

  it('desabilita e reabilita', () => {
    const instalacao = instalado();
    instalacao.configure({ webhookUrl: 'https://destino.test/hook' });
    instalacao.enable({ segredosExigidos: [], segredosPresentes: [] });

    instalacao.disable();
    expect(instalacao.status).toBe('disabled');

    instalacao.enable({ segredosExigidos: [], segredosPresentes: [] });
    expect(instalacao.habilitado).toBe(true);
  });

  it('desabilitar o que não está habilitado é erro, não silêncio', () => {
    expect(() => instalado().disable()).toThrow(TransicaoDePluginInvalidaError);
  });
});

describe('permissões concedidas', () => {
  it('só se concede o que o manifesto pede', () => {
    // Sem esta trava, quem instala daria ao plugin um acesso que o autor
    // nunca declarou — e revisar o manifesto deixaria de valer alguma coisa.
    expect(() =>
      assertPermissoesPedidas(
        'notifications-example',
        ['crm.customer.read'],
        ['crm.customer.read', 'crm.customer.delete'],
      ),
    ).toThrow(PermissaoNaoPedidaError);
  });

  it('conceder menos do que foi pedido é legítimo', () => {
    expect(() =>
      assertPermissoesPedidas(
        'notifications-example',
        ['crm.customer.read', 'crm.appointment.read'],
        ['crm.customer.read'],
      ),
    ).not.toThrow();
  });
});
