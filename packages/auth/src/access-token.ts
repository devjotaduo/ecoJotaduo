import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * JWT HS256 assinado e verificado pela própria plataforma.
 *
 * Decisão de segurança: o algoritmo é FIXO no código. O cabeçalho do token
 * jamais escolhe como verificar — é apenas conferido. Isso elimina por
 * construção as falhas clássicas de "alg confusion" (`alg: none`, troca de
 * HS256 por RS256). Ver docs/adr/0007-auth-mvp.md.
 */
const ALGORITMO = 'HS256';

/**
 * Audiência dos tokens de chamada ENTRE SERVIÇOS da plataforma.
 *
 * Distinta da audiência da API pública de propósito. Um token de usuário não
 * pode ser reapresentado a um serviço interno, e um token interno — de vida
 * curta e escopo mínimo — não abre a API pública. É a regra de "nunca usar o
 * token de um serviço como token de outro", imposta pela verificação de `aud`
 * em vez de por convenção.
 */
export const AUDIENCIA_INTERNA = 'ecojotaduo-internal';
const TIPO = 'JWT';
const TAMANHO_MINIMO_SEGREDO = 32;

export type ActorKind = 'user' | 'service';

export interface AccessTokenClaims {
  /** Id do usuário ou da service account. */
  readonly sub: string;
  /** Tenant ao qual o token está preso. Nunca vem de parâmetro de request. */
  readonly tid: string;
  readonly kind: ActorKind;
  readonly scope: readonly string[];
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly aud: string;
}

export type InvalidTokenReason =
  | 'formato'
  | 'assinatura'
  | 'cabecalho'
  | 'payload'
  | 'expirado'
  | 'emissor'
  | 'audiencia';

export class InvalidTokenError extends Error {
  constructor(
    readonly reason: InvalidTokenReason,
    opcoes?: ErrorOptions,
  ) {
    super(`Token inválido (${reason}).`, opcoes);
    this.name = 'InvalidTokenError';
  }
}

export interface TokenServiceOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTokenTtlSeconds: number;
  /** Tolerância de relógio entre réplicas (padrão: 30s). */
  readonly clockSkewSeconds?: number;
}

function base64url(valor: object): string {
  return Buffer.from(JSON.stringify(valor), 'utf8').toString('base64url');
}

function decodificar(parte: string, motivo: InvalidTokenReason): unknown {
  try {
    return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
  } catch (causa) {
    throw new InvalidTokenError(motivo, { cause: causa });
  }
}

function ehListaDeStrings(valor: unknown): valor is string[] {
  return (
    Array.isArray(valor) && valor.every((item) => typeof item === 'string')
  );
}

export class TokenService {
  private readonly segredo: Buffer;
  private readonly desvio: number;

  constructor(private readonly opcoes: TokenServiceOptions) {
    if (Buffer.byteLength(opcoes.secret, 'utf8') < TAMANHO_MINIMO_SEGREDO) {
      throw new Error(
        `Segredo de assinatura precisa de pelo menos ${TAMANHO_MINIMO_SEGREDO} bytes.`,
      );
    }
    this.segredo = Buffer.from(opcoes.secret, 'utf8');
    this.desvio = opcoes.clockSkewSeconds ?? 30;
  }

  private assinar(conteudo: string): string {
    return createHmac('sha256', this.segredo)
      .update(conteudo)
      .digest('base64url');
  }

  issue(
    entrada: Pick<AccessTokenClaims, 'sub' | 'tid' | 'kind' | 'scope' | 'jti'>,
    agora: Date = new Date(),
  ): { token: string; expiresAt: Date } {
    const iat = Math.floor(agora.getTime() / 1000);
    const exp = iat + this.opcoes.accessTokenTtlSeconds;

    const payload: AccessTokenClaims = {
      ...entrada,
      scope: [...entrada.scope],
      iat,
      exp,
      iss: this.opcoes.issuer,
      aud: this.opcoes.audience,
    };

    const conteudo = `${base64url({ alg: ALGORITMO, typ: TIPO })}.${base64url(payload)}`;
    return {
      token: `${conteudo}.${this.assinar(conteudo)}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  verify(token: string, agora: Date = new Date()): AccessTokenClaims {
    const partes = token.split('.');
    if (partes.length !== 3) {
      throw new InvalidTokenError('formato');
    }
    const [cabecalhoBruto, payloadBruto, assinaturaBruta] = partes as [
      string,
      string,
      string,
    ];

    // 1. Assinatura primeiro: nada do conteúdo é considerado antes disso.
    const esperada = Buffer.from(
      this.assinar(`${cabecalhoBruto}.${payloadBruto}`),
      'base64url',
    );
    const recebida = Buffer.from(assinaturaBruta, 'base64url');
    if (
      recebida.length !== esperada.length ||
      !timingSafeEqual(recebida, esperada)
    ) {
      throw new InvalidTokenError('assinatura');
    }

    // 2. O cabeçalho é conferido, nunca obedecido.
    const cabecalho = decodificar(cabecalhoBruto, 'cabecalho');
    if (
      typeof cabecalho !== 'object' ||
      cabecalho === null ||
      (cabecalho as { alg?: unknown }).alg !== ALGORITMO ||
      (cabecalho as { typ?: unknown }).typ !== TIPO
    ) {
      throw new InvalidTokenError('cabecalho');
    }

    const payload = decodificar(payloadBruto, 'payload');
    if (typeof payload !== 'object' || payload === null) {
      throw new InvalidTokenError('payload');
    }
    const claims = payload as Record<string, unknown>;

    if (
      typeof claims.sub !== 'string' ||
      typeof claims.tid !== 'string' ||
      (claims.kind !== 'user' && claims.kind !== 'service') ||
      typeof claims.jti !== 'string' ||
      typeof claims.iat !== 'number' ||
      typeof claims.exp !== 'number' ||
      !ehListaDeStrings(claims.scope)
    ) {
      throw new InvalidTokenError('payload');
    }
    if (claims.iss !== this.opcoes.issuer) {
      throw new InvalidTokenError('emissor');
    }
    if (claims.aud !== this.opcoes.audience) {
      throw new InvalidTokenError('audiencia');
    }

    const segundos = Math.floor(agora.getTime() / 1000);
    if (segundos > claims.exp + this.desvio) {
      throw new InvalidTokenError('expirado');
    }
    if (claims.iat > segundos + this.desvio) {
      throw new InvalidTokenError('payload');
    }

    return {
      sub: claims.sub,
      tid: claims.tid,
      kind: claims.kind,
      scope: claims.scope,
      jti: claims.jti,
      iat: claims.iat,
      exp: claims.exp,
      iss: claims.iss,
      aud: claims.aud,
    };
  }
}
