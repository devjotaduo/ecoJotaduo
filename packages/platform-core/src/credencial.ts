import type { AccessTokenClaims, TokenService } from '@ecojotaduo/auth';
import { ehTokenPessoal, type IdentityPublicApi } from '@ecojotaduo/identity';
import type { CredentialKind } from '@ecojotaduo/tenant-context';

/**
 * Leitura da credencial apresentada — o primeiro elo da cadeia de autorização,
 * comum a TODAS as bordas.
 *
 * Mora aqui, e não dentro do guard da API, por um motivo aprendido do jeito
 * caro: enquanto esteve lá, o token pessoal funcionava no REST e era recusado
 * pelo gateway MCP — justamente a borda para a qual ele foi criado. Uma borda
 * nova que aceite credencial deve chamar esta função em vez de reescrevê-la;
 * é o mesmo princípio do `criarNucleo`, aplicado à porta de entrada.
 *
 * O que ela NÃO faz: decidir acesso. Isso continua sendo do `AccessGrant`,
 * resolvido do banco a cada requisição.
 */
export interface CredenciaisDeAcesso {
  readonly tokens: TokenService;
  readonly identity: IdentityPublicApi;
}

export interface CredencialLida {
  readonly claims: AccessTokenClaims;
  /** COMO a requisição se autenticou — não confundir com `actor.kind`. */
  readonly credential: CredentialKind;
}

/**
 * Devolve as claims da credencial, ou `null` quando não há `Bearer`.
 *
 * `null` em vez de exceção porque cada borda tem o próprio erro de "não
 * autenticado" (401 do Nest, erro JSON-RPC no gateway). Credencial
 * apresentada e inválida, essa sim, lança — e lança a MESMA coisa para token
 * forjado, expirado e revogado.
 */
export async function lerCredencial(
  deps: CredenciaisDeAcesso,
  cabecalhoAuthorization: string | undefined,
): Promise<CredencialLida | null> {
  if (!cabecalhoAuthorization?.startsWith('Bearer ')) {
    return null;
  }
  const valor = cabecalhoAuthorization.slice('Bearer '.length).trim();

  if (ehTokenPessoal(valor)) {
    const portador = await deps.identity.authenticatePersonalToken(valor);
    return {
      credential: 'personal-token',
      claims: {
        sub: portador.userId,
        tid: portador.tenantId,
        kind: 'user',
        // Teto do token. A decisão continua sendo a interseção com os papéis
        // vivos da pessoa — reduzir aqui restringe, nunca amplia.
        scope: portador.scopes,
        jti: portador.tokenId,
        iat: 0,
        exp: 0,
        iss: '',
        aud: '',
      },
    };
  }

  const claims = deps.tokens.verify(valor);
  return {
    claims,
    credential: claims.kind === 'service' ? 'service' : 'session',
  };
}
