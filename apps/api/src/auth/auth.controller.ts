import type { AuditLogger } from '@ecojotaduo/audit';
import type {
  IssueServiceTokenUseCase,
  RefreshSessionUseCase,
  SignInUseCase,
  TenancyPublicApi,
} from '@ecojotaduo/tenancy';
import { requireAuth } from '@ecojotaduo/tenant-context';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  meResposta,
  minhasEmpresasResposta,
  sessaoRenovadaResposta,
  sessaoResposta,
  tokenDeServicoResposta,
} from './auth.responses';

import {
  AUDIT_LOGGER,
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

const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});

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
  ) {
    const sessao = await this.signIn.execute(corpo);

    return {
      accessToken: sessao.accessToken,
      accessTokenExpiresAt: sessao.accessTokenExpiresAt.toISOString(),
      refreshToken: sessao.refreshToken,
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
  @ApiZodBody(refreshSchema)
  @ApiZodResponse(200, sessaoRenovadaResposta, 'Sessão renovada.')
  @ApiZodResponse(401, problemaSchema, 'Refresh token inválido ou já usado.')
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema))
    corpo: z.infer<typeof refreshSchema>,
  ) {
    const sessao = await this.refreshSession.execute(corpo);

    return {
      accessToken: sessao.accessToken,
      accessTokenExpiresAt: sessao.accessTokenExpiresAt.toISOString(),
      refreshToken: sessao.refreshToken,
      refreshTokenExpiresAt: sessao.refreshTokenExpiresAt.toISOString(),
      permissions: sessao.permissions,
      entitlements: sessao.entitlements,
    };
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
