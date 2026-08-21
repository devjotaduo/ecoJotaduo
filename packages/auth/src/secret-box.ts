import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Cofre dos segredos de integração (tokens de terceiros, chaves de assinatura
 * de webhook) guardados por empresa.
 *
 * Diferente de senha (scrypt) e de token opaco nosso (SHA-256), estes valores
 * precisam voltar em claro na hora de usar — logo é **cifra**, não hash.
 *
 * AES-256-GCM porque é autenticado: adulterar o registro no banco não produz
 * um segredo diferente e silencioso, produz erro. `aad` amarra o texto cifrado
 * ao dono (empresa + plugin + chave): mover a linha de uma empresa para outra
 * dentro do banco não decifra — a RLS já barra, e esta é a segunda tranca.
 */

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12; // recomendado para GCM
const TAMANHO_CHAVE = 32;
const PREFIXO = 'v1';

export class ChaveDeSegredosInvalidaError extends Error {
  constructor(detalhe: string) {
    super(`SECRETS_KEY inválida: ${detalhe}`);
    this.name = 'ChaveDeSegredosInvalidaError';
  }
}

export class SegredoCorrompidoError extends Error {
  constructor() {
    // Sem detalhe: a mensagem vai para o log e pode chegar ao operador.
    super('Segredo armazenado não pôde ser aberto.');
    this.name = 'SegredoCorrompidoError';
  }
}

/** Converte a chave de ambiente (base64, 32 bytes) em material utilizável. */
export function lerChaveDeSegredos(base64: string): Buffer {
  let chave: Buffer;
  try {
    chave = Buffer.from(base64, 'base64');
  } catch {
    throw new ChaveDeSegredosInvalidaError('não é base64.');
  }
  if (chave.length !== TAMANHO_CHAVE) {
    throw new ChaveDeSegredosInvalidaError(
      `esperados ${TAMANHO_CHAVE} bytes, vieram ${chave.length}.`,
    );
  }
  return chave;
}

/** Dono do segredo — entra no cabeçalho autenticado, não no texto cifrado. */
export interface DonoDoSegredo {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly key: string;
}

function cabecalho(dono: DonoDoSegredo): Buffer {
  return Buffer.from(`${dono.tenantId}|${dono.ownerId}|${dono.key}`, 'utf8');
}

/** Cifra. O formato carrega versão, para trocar de algoritmo sem adivinhação. */
export function sealSecret(
  valor: string,
  chave: Buffer,
  dono: DonoDoSegredo,
): string {
  const iv = randomBytes(TAMANHO_IV);
  const cifrador = createCipheriv(ALGORITMO, chave, iv);
  cifrador.setAAD(cabecalho(dono));
  const cifrado = Buffer.concat([
    cifrador.update(valor, 'utf8'),
    cifrador.final(),
  ]);
  const tag = cifrador.getAuthTag();
  return [
    PREFIXO,
    iv.toString('base64'),
    tag.toString('base64'),
    cifrado.toString('base64'),
  ].join('$');
}

export function openSecret(
  selado: string,
  chave: Buffer,
  dono: DonoDoSegredo,
): string {
  const partes = selado.split('$');
  if (partes.length !== 4 || partes[0] !== PREFIXO) {
    throw new SegredoCorrompidoError();
  }
  try {
    const decifrador = createDecipheriv(
      ALGORITMO,
      chave,
      Buffer.from(partes[1] ?? '', 'base64'),
    );
    decifrador.setAAD(cabecalho(dono));
    decifrador.setAuthTag(Buffer.from(partes[2] ?? '', 'base64'));
    return Buffer.concat([
      decifrador.update(Buffer.from(partes[3] ?? '', 'base64')),
      decifrador.final(),
    ]).toString('utf8');
  } catch {
    // Chave errada, dono errado ou byte alterado caem todos aqui — de
    // propósito: distinguir contaria ao atacante qual das três ele acertou.
    throw new SegredoCorrompidoError();
  }
}

/**
 * Comparação de tempo constante para segredos em claro (ex.: conferir uma
 * assinatura recebida). Nunca use `===` para isso.
 */
export function segredosIguais(a: string, b: string): boolean {
  const primeiro = Buffer.from(a, 'utf8');
  const segundo = Buffer.from(b, 'utf8');
  if (primeiro.length !== segundo.length) {
    return false;
  }
  return timingSafeEqual(primeiro, segundo);
}
