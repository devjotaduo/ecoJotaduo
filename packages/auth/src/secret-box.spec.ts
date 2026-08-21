import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ChaveDeSegredosInvalidaError,
  lerChaveDeSegredos,
  openSecret,
  sealSecret,
  SegredoCorrompidoError,
  segredosIguais,
  type DonoDoSegredo,
} from './secret-box';

const chave = randomBytes(32);
const outraChave = randomBytes(32);

const dono: DonoDoSegredo = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  ownerId: 'notifications-example',
  key: 'signingSecret',
};

describe('cofre de segredos', () => {
  it('abre o que selou', () => {
    const selado = sealSecret('valor-de-integracao', chave, dono);
    expect(openSecret(selado, chave, dono)).toBe('valor-de-integracao');
  });

  it('não vaza o valor no texto armazenado', () => {
    const selado = sealSecret('valor-de-integracao', chave, dono);
    expect(selado).not.toContain('valor-de-integracao');
    expect(selado.startsWith('v1$')).toBe(true);
  });

  it('cada selagem usa um IV novo', () => {
    // Dois textos cifrados iguais denunciariam segredos iguais entre empresas.
    const a = sealSecret('mesmo-valor', chave, dono);
    const b = sealSecret('mesmo-valor', chave, dono);
    expect(a).not.toBe(b);
  });

  it('recusa abrir com outra chave', () => {
    const selado = sealSecret('valor', chave, dono);
    expect(() => openSecret(selado, outraChave, dono)).toThrow(
      SegredoCorrompidoError,
    );
  });

  it('recusa abrir para outro dono', () => {
    // Mover a linha de uma empresa para outra no banco não decifra o segredo.
    const selado = sealSecret('valor', chave, dono);
    const invasor = {
      ...dono,
      tenantId: '22222222-2222-4222-8222-222222222222',
    };
    expect(() => openSecret(selado, chave, invasor)).toThrow(
      SegredoCorrompidoError,
    );
  });

  it('recusa texto adulterado', () => {
    const selado = sealSecret('valor', chave, dono);
    const partes = selado.split('$');
    const corrompido = [
      partes[0],
      partes[1],
      partes[2],
      Buffer.from('outra-coisa', 'utf8').toString('base64'),
    ].join('$');
    expect(() => openSecret(corrompido, chave, dono)).toThrow(
      SegredoCorrompidoError,
    );
  });

  it('recusa formato desconhecido', () => {
    expect(() => openSecret('texto-solto', chave, dono)).toThrow(
      SegredoCorrompidoError,
    );
  });
});

describe('lerChaveDeSegredos', () => {
  it('aceita 32 bytes em base64', () => {
    expect(lerChaveDeSegredos(chave.toString('base64'))).toHaveLength(32);
  });

  it('recusa chave curta em vez de esticá-la em silêncio', () => {
    expect(() =>
      lerChaveDeSegredos(randomBytes(16).toString('base64')),
    ).toThrow(ChaveDeSegredosInvalidaError);
  });
});

describe('segredosIguais', () => {
  it('compara valor e tamanho', () => {
    expect(segredosIguais('abc', 'abc')).toBe(true);
    expect(segredosIguais('abc', 'abd')).toBe(false);
    expect(segredosIguais('abc', 'abcd')).toBe(false);
  });
});
