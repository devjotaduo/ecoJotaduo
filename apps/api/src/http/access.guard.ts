import { TokenService, type AccessTokenClaims } from '@ecojotaduo/auth';
import { assertAllAllowed } from '@ecojotaduo/permissions';
import type { TenancyPublicApi } from '@ecojotaduo/tenancy';
import {
  authenticateContext,
  requireContext,
  toTenantId,
  toUserId,
} from '@ecojotaduo/tenant-context';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { TENANCY_API, TOKEN_SERVICE } from '../bootstrap/tokens';

import { PERMISSIONS_KEY, PUBLIC_KEY } from '@ecojotaduo/http-kit';

/**
 * Ponto único de autorização da API.
 *
 * Ordem obrigatória (docs/architecture/security-model.md):
 *   token → tenant (vem do token, nunca do request) → vínculo e papéis →
 *   módulo contratado → permissão da rota.
 *
 * O acesso é resolvido do banco a cada requisição: revogar um papel ou
 * suspender um vínculo tem efeito imediato, sem esperar o token expirar.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  // Injeção explícita em todos os parâmetros: a API não depende de metadados
  // de decorator em runtime (o que também mantém os testes rodando sob Vitest).
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(TENANCY_API) private readonly tenancy: TenancyPublicApi,
  ) {}

  async canActivate(execucao: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      execucao.getHandler(),
      execucao.getClass(),
    ]);
    if (publico) {
      return true;
    }

    const requisicao = execucao.switchToHttp().getRequest<FastifyRequest>();
    const claims = this.lerToken(requisicao);

    const grant =
      claims.kind === 'service'
        ? await this.tenancy.resolveServiceAccess({
            tenantId: claims.tid,
            scopes: claims.scope,
          })
        : await this.tenancy.resolveUserAccess({
            tenantId: claims.tid,
            userId: claims.sub,
            scopes: claims.scope,
          });

    const contexto = requireContext();
    authenticateContext(contexto, {
      tenantId: toTenantId(claims.tid),
      userId: claims.kind === 'user' ? toUserId(claims.sub) : undefined,
      actor: { kind: claims.kind, id: claims.sub },
      permissions: grant.permissions,
      scopes: grant.scopes,
      entitlements: grant.entitlements,
    });

    const exigidas = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [execucao.getHandler(), execucao.getClass()],
    );
    if (exigidas?.length) {
      // Lança ForbiddenError (403) — tratado pelo filtro de Problem Details.
      assertAllAllowed(grant, exigidas);
    }

    return true;
  }

  private lerToken(requisicao: FastifyRequest): AccessTokenClaims {
    const cabecalho = requisicao.headers.authorization;
    if (!cabecalho?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de acesso ausente.');
    }
    // InvalidTokenError vira 401 no filtro; a razão fica só no log.
    return this.tokens.verify(cabecalho.slice('Bearer '.length).trim());
  }
}
