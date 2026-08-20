import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derivar = promisify(scrypt) as (
  senha: string | Buffer,
  sal: Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Parâmetros do scrypt conforme recomendação OWASP (N=2^16, r=8, p=2).
 * `maxmem` precisa ser maior que 128 * N * r (~64 MiB) — o padrão do Node
 * (32 MiB) rejeitaria estes parâmetros.
 */
const PARAMS = { N: 65536, r: 8, p: 2, maxmem: 256 * 1024 * 1024 } as const;
const TAMANHO_CHAVE = 32;
const TAMANHO_SAL = 16;
const ALGORITMO = 'scrypt';

export class InvalidPasswordHashError extends Error {
  constructor(motivo: string) {
    super(`Hash de senha inválido: ${motivo}`);
    this.name = 'InvalidPasswordHashError';
  }
}

/**
 * Gera hash no formato `scrypt$N$r$p$sal$chave` (parâmetros embutidos, para
 * permitir endurecê-los no futuro sem invalidar as senhas existentes).
 */
export async function hashPassword(senha: string): Promise<string> {
  const sal = randomBytes(TAMANHO_SAL);
  const chave = await derivar(
    senha.normalize('NFKC'),
    sal,
    TAMANHO_CHAVE,
    PARAMS,
  );
  return [
    ALGORITMO,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    sal.toString('base64url'),
    chave.toString('base64url'),
  ].join('$');
}

/** Comparação em tempo constante; nunca lança por senha errada, só retorna false. */
export async function verifyPassword(
  senha: string,
  hash: string,
): Promise<boolean> {
  const partes = hash.split('$');
  if (partes.length !== 6 || partes[0] !== ALGORITMO) {
    throw new InvalidPasswordHashError('formato desconhecido');
  }

  const N = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    throw new InvalidPasswordHashError('parâmetros não numéricos');
  }

  const sal = Buffer.from(partes[4] ?? '', 'base64url');
  const esperado = Buffer.from(partes[5] ?? '', 'base64url');
  if (sal.length === 0 || esperado.length === 0) {
    throw new InvalidPasswordHashError('sal ou chave ausente');
  }

  const calculado = await derivar(
    senha.normalize('NFKC'),
    sal,
    esperado.length,
    {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    },
  );

  return timingSafeEqual(calculado, esperado);
}
