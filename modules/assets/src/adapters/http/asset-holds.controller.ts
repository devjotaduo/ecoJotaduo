import {
  ApiErrosPadrao,
  ApiZodBody,
  ApiZodResponse,
  problemaSchema,
  RequirePermissions,
  ZodValidationPipe,
} from '@ecojotaduo/http-kit';
import { requireAuth } from '@ecojotaduo/tenant-context';
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import type {
  HoldAssetUseCase,
  ReleaseHoldUseCase,
} from '../../application/assets.use-cases';
import { ASSETS_HOLD, ASSETS_RELEASE } from '../../assets.tokens';

import { bloquearSchema } from './dto';
import { bloqueioJson } from './presenters';
import { bloqueioResposta } from './responses';

/**
 * Bloqueios: o que tira o ativo de circulação.
 *
 * Recurso próprio, e não um campo do ativo, porque a indisponibilidade tem
 * motivo, período e história — e é sobre ela que Operações e Manutenção vão
 * perguntar.
 */
@ApiTags('Ativos')
@ApiBearerAuth()
@Controller('api/v1/asset-holds')
export class AssetHoldsController {
  constructor(
    @Inject(ASSETS_HOLD) private readonly bloquear: HoldAssetUseCase,
    @Inject(ASSETS_RELEASE) private readonly liberar: ReleaseHoldUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('assets.asset.hold')
  @ApiOperation({
    operationId: 'holdAsset',
    summary: 'Bloqueia um ativo por um período, com motivo',
  })
  @ApiZodBody(bloquearSchema)
  @ApiZodResponse(201, bloqueioResposta, 'Bloqueio criado.')
  @ApiZodResponse(
    409,
    problemaSchema,
    'O ativo já está bloqueado no período, ou foi baixado.',
  )
  @ApiErrosPadrao()
  async criar(
    @Body(new ZodValidationPipe(bloquearSchema))
    corpo: z.infer<typeof bloquearSchema>,
  ) {
    const { tenantId } = requireAuth();
    return bloqueioJson(
      await this.bloquear.execute({
        tenantId,
        assetId: corpo.assetId,
        reason: corpo.reason,
        startsAt: new Date(corpo.startsAt),
        endsAt: new Date(corpo.endsAt),
        notes: corpo.notes,
      }),
    );
  }

  @Post(':holdId/release')
  @HttpCode(200)
  @RequirePermissions('assets.asset.hold')
  @ApiOperation({
    operationId: 'releaseAssetHold',
    summary: 'Libera o bloqueio agora, devolvendo o ativo à operação',
  })
  @ApiZodResponse(200, bloqueioResposta, 'Bloqueio liberado.')
  @ApiZodResponse(409, problemaSchema, 'O bloqueio já havia sido liberado.')
  @ApiErrosPadrao()
  async liberarBloqueio(@Param('holdId', ParseUUIDPipe) holdId: string) {
    const { tenantId } = requireAuth();
    return bloqueioJson(await this.liberar.execute({ tenantId, holdId }));
  }
}
