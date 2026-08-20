import type { TokenService } from '@ecojotaduo/auth';
import type { McpToolContext } from '@ecojotaduo/mcp-kit';
import type { AccessGrant } from '@ecojotaduo/permissions';
import type { TenancyPublicApi } from '@ecojotaduo/tenancy';
import {
  authenticateContext,
  createContext,
  toTenantId,
  toUserId,
  type RequestContext,
} from '@ecojotaduo/tenant-context';

/** Falha de autenticação. A razão real fica no log, nunca na resposta. */
export class NaoAutenticadoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'NaoAutenticadoError';
  }
}

/** Tudo que o servidor MCP precisa saber sobre quem está do outro lado. */
export interface SessaoMcp {
  readonly grant: AccessGrant;
  readonly contexto: RequestContext;
  /** Identidade repassada às capacidades — sempre derivada do token. */
  readonly capacidade: McpToolContext;
}

export interface DependenciasDeAutorizacao {
  readonly tokens: TokenService;
  readonly tenancy: TenancyPublicApi;
}

/**
 * Autoriza a requisição MCP com a MESMA cadeia da API REST
 * (`apps/api/src/http/access.guard.ts`):
 *
 *   token → tenant (claim do token, nunca parâmetro) → vínculo e papéis →
 *   módulo contratado → permissão da capacidade
 *
 * As duas últimas etapas acontecem no catálogo, que decide tanto o que o host
 * *descobre* quanto o que ele consegue *executar*. Resolver do banco a cada
 * requisição é o que faz revogar papel ou cancelar módulo valer na hora,
 * mesmo com um token ainda dentro da validade.
 */
export async function autorizar(
  deps: DependenciasDeAutorizacao,
  cabecalhoAuthorization: string | undefined,
  correlationId: string,
): Promise<SessaoMcp> {
  if (!cabecalhoAuthorization?.startsWith('Bearer ')) {
    throw new NaoAutenticadoError('Token de acesso ausente.');
  }

  const claims = deps.tokens.verify(
    cabecalhoAuthorization.slice('Bearer '.length).trim(),
  );

  const grant =
    claims.kind === 'service'
      ? await deps.tenancy.resolveServiceAccess({
          tenantId: claims.tid,
          scopes: claims.scope,
        })
      : await deps.tenancy.resolveUserAccess({
          tenantId: claims.tid,
          userId: claims.sub,
          scopes: claims.scope,
        });

  const contexto = createContext('mcp', correlationId);
  authenticateContext(contexto, {
    tenantId: toTenantId(claims.tid),
    userId: claims.kind === 'user' ? toUserId(claims.sub) : undefined,
    actor: { kind: claims.kind, id: claims.sub },
    permissions: grant.permissions,
    scopes: grant.scopes,
    entitlements: grant.entitlements,
  });

  return {
    grant,
    contexto,
    capacidade: { tenantId: claims.tid, actorId: claims.sub },
  };
}
