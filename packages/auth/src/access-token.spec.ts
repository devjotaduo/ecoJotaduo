import { createHmac, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InvalidTokenError, TokenService } from './access-token';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-bytes!!';
const OUTRO_SEGREDO = 'outro-segredo-de-teste-com-32-bytes!!!!';

const servico = new TokenService({
  secret: SEGREDO,
  issuer: 'movimentar',
  audience: 'movimentar-api',
  accessTokenTtlSeconds: 900,
});

function emitir(tenant = 'tenant-a') {
  return servico.issue({
    sub: 'usuario-1',
    tid: tenant,
    kind: 'user',
    scope: ['crm.customer.read'],
    jti: randomUUID(),
  });
}

function base64url(valor: object): string {
  return Buffer.from(JSON.stringify(valor), 'utf8').toString('base64url');
}

describe('TokenService', () => {
  it('exige segredo com entropia mínima', () => {
    expect(
      () =>
        new TokenService({
          secret: 'curto',
          issuer: 'a',
          audience: 'b',
          accessTokenTtlSeconds: 60,
        }),
    ).toThrow(/32 bytes/);
  });

  it('emite e verifica um token, preservando as claims', () => {
    const { token, expiresAt } = emitir();
    const claims = servico.verify(token);

    expect(claims.sub).toBe('usuario-1');
    expect(claims.tid).toBe('tenant-a');
    expect(claims.scope).toEqual(['crm.customer.read']);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejeita token com assinatura de outro segredo', () => {
    const invasor = new TokenService({
      secret: OUTRO_SEGREDO,
      issuer: 'movimentar',
      audience: 'movimentar-api',
      accessTokenTtlSeconds: 900,
    });
    const { token } = invasor.issue({
      sub: 'usuario-1',
      tid: 'tenant-b',
      kind: 'user',
      scope: ['*'],
      jti: randomUUID(),
    });

    expect(() => servico.verify(token)).toThrow(InvalidTokenError);
  });

  it('rejeita payload adulterado para trocar de tenant', () => {
    const { token } = emitir('tenant-a');
    const [cabecalho, payload, assinatura] = token.split('.') as [
      string,
      string,
      string,
    ];

    const adulterado = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    adulterado.tid = 'tenant-b';

    const forjado = `${cabecalho}.${base64url(adulterado)}.${assinatura}`;
    expect(() => servico.verify(forjado)).toThrow(
      expect.objectContaining({ reason: 'assinatura' }) as Error,
    );
  });

  it('rejeita ataque "alg: none" (token sem assinatura)', () => {
    const payload = base64url({
      sub: 'invasor',
      tid: 'tenant-b',
      kind: 'user',
      scope: ['*'],
      jti: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
      iss: 'movimentar',
      aud: 'movimentar-api',
    });
    const semAssinatura = `${base64url({ alg: 'none', typ: 'JWT' })}.${payload}.`;

    expect(() => servico.verify(semAssinatura)).toThrow(InvalidTokenError);
  });

  it('rejeita token cujo cabeçalho anuncia outro algoritmo, mesmo com HMAC válido', () => {
    // Simula um cliente que assina com HS256 mas declara HS512 no cabeçalho:
    // a assinatura confere, mas o cabeçalho inconsistente é recusado.
    const cabecalho = base64url({ alg: 'HS512', typ: 'JWT' });
    const payload = base64url({
      sub: 'invasor',
      tid: 'tenant-b',
      kind: 'user',
      scope: ['*'],
      jti: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
      iss: 'movimentar',
      aud: 'movimentar-api',
    });
    const assinatura = createHmac('sha256', SEGREDO)
      .update(`${cabecalho}.${payload}`)
      .digest('base64url');

    expect(() =>
      servico.verify(`${cabecalho}.${payload}.${assinatura}`),
    ).toThrow(expect.objectContaining({ reason: 'cabecalho' }) as Error);
  });

  it('rejeita token expirado (além da tolerância de relógio)', () => {
    const { token } = emitir();
    const futuro = new Date(Date.now() + 901_000 + 31_000);
    expect(() => servico.verify(token, futuro)).toThrow(
      expect.objectContaining({ reason: 'expirado' }) as Error,
    );
  });

  it('aceita token dentro da tolerância de relógio', () => {
    const { token } = emitir();
    const quaseExpirado = new Date(Date.now() + 900_000 + 10_000);
    expect(servico.verify(token, quaseExpirado).sub).toBe('usuario-1');
  });

  it('rejeita token de outro emissor ou outra audiência', () => {
    const outroEmissor = new TokenService({
      secret: SEGREDO,
      issuer: 'outro-sistema',
      audience: 'movimentar-api',
      accessTokenTtlSeconds: 900,
    });
    const { token } = outroEmissor.issue({
      sub: 'u',
      tid: 't',
      kind: 'user',
      scope: [],
      jti: randomUUID(),
    });

    expect(() => servico.verify(token)).toThrow(
      expect.objectContaining({ reason: 'emissor' }) as Error,
    );
  });

  it('rejeita formatos malformados sem vazar exceção interna', () => {
    for (const entrada of ['', 'abc', 'a.b', 'a.b.c.d', '...']) {
      expect(() => servico.verify(entrada)).toThrow(InvalidTokenError);
    }
  });
});
