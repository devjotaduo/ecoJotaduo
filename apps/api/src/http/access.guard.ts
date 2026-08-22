import { registrarNegacao, type AuditLogger } from '@ecojotaduo/audit';
import { TokenService } from '@ecojotaduo/auth';
import type { IdentityPublicApi } from '@ecojotaduo/identity';
import { assertAllAllowed, ForbiddenError } from '@ecojotaduo/permissions';
import { lerCredencial } from '@ecojotaduo/platform-core';
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

import {
  AUDIT_LOGGER,
  IDENTITY_API,
  TENANCY_API,
  TOKEN_SERVICE,
} from '../bootstrap/tokens';

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
 *
 * A recusa por permissão é auditada aqui. A recusa por token, vínculo ou
 * empresa NÃO é: nesses casos ainda não há empresa autenticada no contexto,
 * e gravar a trilha exigiria escolher um tenant a partir de um token que
 * pode ser forjado — inventaria rastro em vez de registrá-lo.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  // Injeção explícita em todos os parâmetros: a API não depende de metadados
  // de decorator em runtime (o que também mantém os testes rodando sob Vitest).
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(TENANCY_API) private readonly tenancy: TenancyPublicApi,
    @Inject(AUDIT_LOGGER) private readonly audit: AuditLogger,
    @Inject(IDENTITY_API) private readonly identity: IdentityPublicApi,
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
    // Uma leitura de credencial só, compartilhada com o gateway MCP: enquanto
    // cada borda teve a sua, o token pessoal valia no REST e não no MCP.
    const lida = await lerCredencial(
      { tokens: this.tokens, identity: this.identity },
      requisicao.headers.authorization,
    );
    if (!lida) {
      throw new UnauthorizedException('Token de acesso ausente.');
    }
    const { claims, credential: credencial } = lida;

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
      credential: credencial,
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
      // A recusa deixa rastro ANTES de subir: sem isso, alguém sondando rotas
      // proibidas não aparece em lugar nenhum, que é justamente o padrão que
      // se quer enxergar antes de um incidente, e não depois.
      try {
        assertAllAllowed(grant, exigidas);
      } catch (erro) {
        if (erro instanceof ForbiddenError) {
          await registrarNegacao(this.audit, {
            alvo: `${requisicao.method} ${requisicao.routeOptions?.url ?? requisicao.url}`,
            required: erro.required,
            reason: erro.reason,
            moduleId: erro.moduleId,
          });
        }
        throw erro;
      }
    }

    return true;
  }

  /**
   * Duas credenciais, um resultado.
   *
   * O access token de sessão dura quinze minutos e é um JWT. O token pessoal é
   * opaco, de longa duração, e existe para o caso em que um programa age em
   * nome de uma pessoa de forma continuada (um agente num host MCP manda
   * cabeçalho fixo — não tem como refazer login).
   *
   * As duas terminam nas MESMAS claims, e daí para frente a cadeia de
   * autorização é uma só: vínculo, papéis, módulo contratado, permissão da
   * rota. Um token pessoal não é um caminho paralelo; é outra porta para a
   * mesma porteira.
   *
   * O prefixo decide qual é. Tentar decodificar como JWT primeiro faria um
   * token pessoal passar por "assinatura inválida", que é a mensagem errada.
   */
}
