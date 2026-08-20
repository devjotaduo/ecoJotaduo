import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens opacos (refresh tokens e segredos de service account).
 *
 * Diferente de senha humana, estes valores são gerados por nós com 256 bits de
 * entropia — não há o que adivinhar por força bruta, então SHA-256 basta e é
 * rápido o suficiente para o caminho de autenticação máquina-a-máquina.
 * Guardamos apenas o hash: vazamento do banco não revela o token.
 */
const TAMANHO_BYTES = 32;

export function createOpaqueToken(): string {
  return randomBytes(TAMANHO_BYTES).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export function opaqueTokenMatches(
  token: string,
  hashArmazenado: string,
): boolean {
  const calculado = Buffer.from(hashOpaqueToken(token), 'base64url');
  const esperado = Buffer.from(hashArmazenado, 'base64url');
  if (calculado.length !== esperado.length) {
    return false;
  }
  return timingSafeEqual(calculado, esperado);
}
