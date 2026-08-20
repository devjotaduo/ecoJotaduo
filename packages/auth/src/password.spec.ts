import { describe, expect, it } from 'vitest';

import {
  createOpaqueToken,
  hashOpaqueToken,
  opaqueTokenMatches,
} from './opaque-token';
import {
  hashPassword,
  InvalidPasswordHashError,
  verifyPassword,
} from './password';

describe('hash de senha (scrypt)', () => {
  it(
    'aceita a senha correta e recusa a errada',
    { timeout: 20_000 },
    async () => {
      const hash = await hashPassword('senha-super-secreta');

      await expect(verifyPassword('senha-super-secreta', hash)).resolves.toBe(
        true,
      );
      await expect(verifyPassword('senha-super-secretA', hash)).resolves.toBe(
        false,
      );
      await expect(verifyPassword('', hash)).resolves.toBe(false);
    },
  );

  it(
    'usa sal aleatório: mesma senha gera hashes diferentes',
    { timeout: 20_000 },
    async () => {
      const [a, b] = await Promise.all([
        hashPassword('igual'),
        hashPassword('igual'),
      ]);
      expect(a).not.toBe(b);
      await expect(verifyPassword('igual', a)).resolves.toBe(true);
      await expect(verifyPassword('igual', b)).resolves.toBe(true);
    },
  );

  it('grava os parâmetros no hash (permite endurecer sem invalidar senhas)', async () => {
    const hash = await hashPassword('x');
    expect(hash.startsWith('scrypt$65536$8$2$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
  });

  it('normaliza unicode equivalente (NFKC)', { timeout: 20_000 }, async () => {
    // Mesma senha digitada em teclados diferentes: "á" composto (U+00E1) e
    // decomposto (a + U+0301) precisam autenticar igual.
    const composto = 'senhá';
    const decomposto = 'senhá';
    expect(composto).not.toBe(decomposto);

    const hash = await hashPassword(composto);
    await expect(verifyPassword(decomposto, hash)).resolves.toBe(true);
  });

  it('rejeita hash com formato desconhecido em vez de aceitar silenciosamente', async () => {
    await expect(verifyPassword('x', 'md5$abc')).rejects.toThrow(
      InvalidPasswordHashError,
    );
    await expect(verifyPassword('x', '')).rejects.toThrow(
      InvalidPasswordHashError,
    );
  });
});

describe('tokens opacos', () => {
  it('gera tokens únicos com entropia alta', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => createOpaqueToken()),
    );
    expect(tokens.size).toBe(50);
    expect(createOpaqueToken().length).toBeGreaterThanOrEqual(43);
  });

  it('armazena apenas o hash e confere corretamente', () => {
    const token = createOpaqueToken();
    const hash = hashOpaqueToken(token);

    expect(hash).not.toContain(token);
    expect(opaqueTokenMatches(token, hash)).toBe(true);
    expect(opaqueTokenMatches(createOpaqueToken(), hash)).toBe(false);
  });

  it('não quebra com hash de tamanho diferente', () => {
    expect(opaqueTokenMatches(createOpaqueToken(), 'abc')).toBe(false);
  });
});
