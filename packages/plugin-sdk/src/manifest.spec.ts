import { describe, expect, it } from 'vitest';

import { ManifestoInvalidoError, validarManifesto } from './manifest';

const valido = {
  manifestVersion: '1',
  id: 'notifications-example',
  name: 'Notificações (exemplo)',
  version: '1.0.0',
  publisher: 'ecoJotaduo',
  type: 'first-party',
  platformVersion: '^0.1.0',
  description: 'Entrega mensagens por webhook assinado.',
  permissions: ['crm.customer.read'],
  capabilities: { http: true, mcp: true },
  requiredSecrets: ['signingSecret'],
};

describe('validarManifesto', () => {
  it('aceita e completa os campos opcionais', () => {
    const manifesto = validarManifesto(valido);
    expect(manifesto.id).toBe('notifications-example');
    expect(manifesto.subscribesTo).toEqual([]);
    expect(manifesto.publishes).toEqual([]);
  });

  it('recusa versão de manifesto desconhecida', () => {
    // Aceitar em silêncio faria a plataforma ignorar campos novos que o autor
    // do plugin acha que estão valendo.
    expect(() => validarManifesto({ ...valido, manifestVersion: '2' })).toThrow(
      ManifestoInvalidoError,
    );
  });

  it('recusa id que não serve como permissão nem como caminho', () => {
    for (const id of ['Notificações', 'com espaco', 'ab', '-inicio']) {
      expect(() => validarManifesto({ ...valido, id })).toThrow(
        ManifestoInvalidoError,
      );
    }
  });

  it('lista TODAS as violações de uma vez', () => {
    try {
      validarManifesto({ ...valido, version: 'ontem', publisher: '' });
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect((erro as Error).message).toContain('version');
      expect((erro as Error).message).toContain('publisher');
    }
  });

  it('recusa plugin que pede permissão sobre a própria capacidade', () => {
    // Quem libera a capacidade do plugin é o papel do usuário; se o plugin
    // pudesse conceder a si mesmo, a instalação viraria escalada de acesso.
    expect(() =>
      validarManifesto({
        ...valido,
        permissions: ['plugin.notifications-example.message.send'],
      }),
    ).toThrow(/capacidade do próprio plugin/);
  });

  it('recusa evento que nenhum módulo publica', () => {
    expect(() =>
      validarManifesto(
        { ...valido, subscribesTo: ['crm.custumer.created.v1'] },
        { eventosConhecidos: ['crm.customer.created.v1'] },
      ),
    ).toThrow(/não é publicado por nenhum módulo/);
  });

  it('aceita evento que existe', () => {
    const manifesto = validarManifesto(
      { ...valido, subscribesTo: ['crm.customer.created.v1'] },
      { eventosConhecidos: ['crm.customer.created.v1'] },
    );
    expect(manifesto.subscribesTo).toEqual(['crm.customer.created.v1']);
  });

  it('recusa formato de evento fora da convenção versionada', () => {
    expect(() =>
      validarManifesto({ ...valido, publishes: ['notificacao-enviada'] }),
    ).toThrow(ManifestoInvalidoError);
  });
});
