import type { ManageEntitlementsUseCase } from '@ecojotaduo/tenancy';
import { requireAuth } from '@ecojotaduo/tenant-context';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  entitlementResposta,
  entitlementsResposta,
} from '../auth/auth.responses';

import { MANAGE_ENTITLEMENTS_USE_CASE } from '../bootstrap/tokens';
import {
  ApiErrosPadrao,
  ApiZodBody,
  ApiZodResponse,
  problemaSchema,
  RequirePermissions,
  ZodValidationPipe,
} from '@ecojotaduo/http-kit';

const MODULE_ID = /^[a-z][a-z0-9-]*$/;

const moduleIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(MODULE_ID, 'moduleId inválido');

const grantSchema = z.object({
  moduleId: moduleIdSchema,
  expiresAt: z.iso.datetime().optional(),
});

/**
 * Contratação de módulos por empresa.
 *
 * O tenant vem SEMPRE do contexto autenticado — não existe parâmetro de
 * tenant nestas rotas, então nem um cliente malicioso nem um agente de IA
 * conseguem contratar módulo para outra empresa.
 */
@ApiTags('Plataforma — Módulos')
@ApiBearerAuth()
@Controller('api/v1/modules')
export class EntitlementsController {
  constructor(
    @Inject(MANAGE_ENTITLEMENTS_USE_CASE)
    private readonly entitlements: ManageEntitlementsUseCase,
  ) {}

  @Get()
  @RequirePermissions('platform.tenant.read')
  @ApiOperation({
    operationId: 'platformListModules',
    summary: 'Lista os módulos contratados',
  })
  @ApiZodResponse(200, entitlementsResposta, 'Módulos ativos da empresa.')
  @ApiErrosPadrao()
  async list() {
    const { tenantId } = requireAuth();
    const items = await this.entitlements.list(tenantId);
    return { items };
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('platform.module.manage')
  @ApiOperation({
    operationId: 'platformGrantModule',
    summary: 'Contrata um módulo',
  })
  @ApiZodBody(grantSchema)
  @ApiZodResponse(
    201,
    entitlementResposta.pick({ moduleId: true, status: true }),
    'Módulo contratado.',
  )
  @ApiZodResponse(409, problemaSchema, 'Módulo já contratado.')
  @ApiErrosPadrao()
  async grant(
    @Body(new ZodValidationPipe(grantSchema))
    corpo: z.infer<typeof grantSchema>,
  ) {
    const { tenantId } = requireAuth();
    await this.entitlements.grant({
      tenantId,
      moduleId: corpo.moduleId,
      expiresAt: corpo.expiresAt ? new Date(corpo.expiresAt) : null,
    });
    return { moduleId: corpo.moduleId, status: 'active' };
  }

  @Delete(':moduleId')
  @HttpCode(204)
  @RequirePermissions('platform.module.manage')
  @ApiOperation({
    operationId: 'platformRevokeModule',
    summary: 'Cancela um módulo',
  })
  @ApiErrosPadrao()
  async revoke(
    @Param('moduleId', new ZodValidationPipe(moduleIdSchema)) moduleId: string,
  ) {
    const { tenantId } = requireAuth();
    await this.entitlements.revoke({ tenantId, moduleId });
  }
}
