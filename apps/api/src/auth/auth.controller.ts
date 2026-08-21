import type { AuditLogger } from '@ecojotaduo/audit';
import type { Env } from '@ecojotaduo/config';
import { RefreshTokenInvalidError } from '@ecojotaduo/identity';
import type {
  IssueServiceTokenUseCase,
  RefreshSessionUseCase,
  SignInUseCase,
  TenancyPublicApi,
} from '@ecojotaduo/tenancy';
import { requireAuth } from '@ecojotaduo/tenant-context';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  meResposta,
  minhasEmpresasResposta,
  sessaoRenovadaResposta,
  sessaoResposta,
  tokenDeServicoResposta,
} from './auth.responses';

import {
  gravarCookieDeRenovacao,
  lerCookieDeRenovacao,
  limparCookieDeRenovacao,
} from './refresh-cookie';

import {
  AUDIT_LOGGER,
  ENV,
  ISSUE_SERVICE_TOKEN_USE_CASE,
  REFRESH_SESSION_USE_CASE,
  SIGN_IN_USE_CASE,
  TENANCY_API,
} from '../bootstrap/tokens';
import {
  ApiErrosPadrao,
  ApiZodBody,
  ApiZodResponse,
  problemaSchema,
  Public,
  ZodValidationPipe,
} from '@ecojotaduo/http-kit';

const loginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(512),
  tenantSlug: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9-]+$/,
      'slug deve conter apenas letras minúsculas, números e hífen',
    ),
});

/**
 * A renovação não recebe corpo: o refresh token vem no cookie `httpOnly`.
 * Aceitá-lo também por corpo reabriria exatamente o caminho que o cookie
 * fecha — bastaria um XSS convencer a página a mandar o que roubou.
 */
export const SEM_SESSAO = 'Sessão ausente ou expirada.';

const serviceTokenSchema = z.object({
  clientId: z.string().min(1).max(128),
  clientSecret: z.string().min(1).max(512),
});

@ApiTags('Autenticação')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(SIGN_IN_USE_CASE) private readonly signIn: SignInUseCase,
    @Inject(REFRESH_SESSION_USE_CASE)
    private readonly refreshSession: RefreshSessionUseCase,
    @Inject(ISSUE_SERVICE_TOKEN_USE_CASE)
    private readonly serviceToken: IssueServiceTokenUseCase,
    @Inject(TENANCY_API) private readonly tenancy: TenancyPublicApi,
    @Inject(AUDIT_LOGGER) private readonly audit: AuditLogger,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ operationId: 'authLogin', summary: 'Entra em uma empresa' })
  @ApiZodBody(loginSchema)
  @ApiZodResponse(200, sessaoResposta, 'Sessão criada.')
  @ApiZodResponse(401, problemaSchema, 'Credenciais inválidas.')
  async login(
    @Body(new ZodValidationPipe(loginSchema))
    corpo: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ) {
    const sessao = await this.signIn.execute(corpo);
    gravarCookieDeRenovacao(resposta, this.env, sessao.refreshToken);

    return {
      accessToken: sessao.accessToken,
      accessTokenExpiresAt: sessao.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: sessao.refreshTokenExpiresAt.toISOString(),
      tenant: sessao.tenant,
      user: sessao.user,
      permissions: sessao.permissions,
      entitlements: sessao.entitlements,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'authRefresh',
    summary: 'Renova a sessão (rotaciona o refresh token)',
  })
  @ApiZodResponse(200, sessaoRenovadaResposta, 'Sessão renovada.')
  @ApiZodResponse(401, problemaSchema, 'Sessão inválida ou já usada.')
  async refresh(
    @Req() requisicao: FastifyRequest,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ) {
    const refreshToken = lerCookieDeRenovacao(requisicao);
    if (!refreshToken) {
      // Mesmo 401 de token inválido: quem chama não precisa saber se o cookie
      // faltou ou se já tinha sido queimado.
      throw new RefreshTokenInvalidError();
    }

    const sessao = await this.refreshSession.execute({ refreshToken });
    gravarCookieDeRenovacao(resposta, this.env, sessao.refreshToken);

    return {
      accessToken: sessao.accessToken,
      accessTokenExpiresAt: sessao.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: sessao.refreshTokenExpiresAt.toISOString(),
      permissions: sessao.permissions,
      entitlements: sessao.entitlements,
    };
  }

  /**
   * Encerra a sessão.
   *
   * Passa a existir porque o cookie é `httpOnly`: a tela não consegue mais
   * apagá-lo sozinha, então sair vira uma operação de servidor. Além de
   * limpar o cookie, a família de refresh tokens é revogada — sair numa aba
   * tem de valer nas outras, e num equipamento perdido também.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ operationId: 'authLogout', summary: 'Encerra a sessão' })
  async logout(
    @Req() requisicao: FastifyRequest,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<void> {
    const refreshToken = lerCookieDeRenovacao(requisicao);
    limparCookieDeRenovacao(resposta, this.env);

    if (refreshToken) {
      // Sem token não há o que revogar, e sair continua devolvendo 204: uma
      // sessão já morta responder erro só atrapalharia quem está saindo.
      await this.refreshSession.revokeSession(refreshToken);
    }
  }

  /** Autenticação de aplicação (client credentials), sem refresh token. */
  @Public()
  @Post('token')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'authServiceToken',
    summary: 'Autentica uma aplicação (client credentials)',
  })
  @ApiZodBody(serviceTokenSchema)
  @ApiZodResponse(200, tokenDeServicoResposta, 'Token emitido.')
  @ApiZodResponse(401, problemaSchema, 'Credenciais inválidas.')
  async token(
    @Body(new ZodValidationPipe(serviceTokenSchema))
    corpo: z.infer<typeof serviceTokenSchema>,
  ) {
    const emitido = await this.serviceToken.execute(corpo);

    return {
      accessToken: emitido.accessToken,
      expiresAt: emitido.expiresAt.toISOString(),
      tokenType: 'Bearer',
      scopes: emitido.scopes,
    };
  }

  /** Identidade e acesso efetivo do portador do token. */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    operationId: 'authMe',
    summary: 'Identidade e acesso efetivo do token',
  })
  @ApiZodResponse(200, meResposta, 'Contexto autenticado.')
  @ApiErrosPadrao()
  me() {
    const auth = requireAuth();
    return {
      tenantId: auth.tenantId,
      actor: auth.actor,
      permissions: auth.permissions,
      scopes: auth.scopes,
      entitlements: auth.entitlements,
    };
  }

  /** Empresas em que o usuário autenticado tem vínculo ativo. */
  @Get('my-tenants')
  @ApiBearerAuth()
  @ApiOperation({
    operationId: 'authMyTenants',
    summary: 'Empresas em que o usuário tem vínculo',
  })
  @ApiZodResponse(200, minhasEmpresasResposta, 'Empresas do usuário.')
  @ApiErrosPadrao()
  async myTenants() {
    const auth = requireAuth();
    if (!auth.userId) {
      return { items: [] };
    }
    const items = await this.tenancy.listTenantsOfUser(auth.userId);
    await this.audit.record({
      action: 'tenancy.tenants.listed',
      result: 'success',
    });
    return { items };
  }
}
