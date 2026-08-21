import {
  ApiErrosPadrao,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  problemaSchema,
  RequirePermissions,
  ZodValidationPipe,
} from '@ecojotaduo/http-kit';
import { requireAuth } from '@ecojotaduo/tenant-context';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import type {
  CheckAvailabilityUseCase,
  GetAssetUseCase,
  RegisterAssetUseCase,
  RetireAssetUseCase,
  SearchAssetsUseCase,
  UpdateAssetUseCase,
} from '../../application/assets.use-cases';
import {
  ASSETS_AVAILABILITY,
  ASSETS_GET,
  ASSETS_REGISTER,
  ASSETS_RETIRE,
  ASSETS_SEARCH,
  ASSETS_UPDATE,
} from '../../assets.tokens';

import {
  atualizarAtivoSchema,
  baixarAtivoSchema,
  cadastrarAtivoSchema,
  consultarDisponibilidadeSchema,
  pesquisarAtivosSchema,
} from './dto';
import { ativoJson, bloqueioJson, disponibilidadeJson } from './presenters';
import {
  ativoComHistoricoResposta,
  ativoResposta,
  ativosPaginados,
  disponibilidadeResposta,
} from './responses';

/** Ativos: cadastro, disponibilidade derivada e baixa. */
@ApiTags('Ativos')
@ApiBearerAuth()
@Controller('api/v1/assets')
export class AssetsController {
  constructor(
    @Inject(ASSETS_REGISTER) private readonly cadastrar: RegisterAssetUseCase,
    @Inject(ASSETS_UPDATE) private readonly atualizar: UpdateAssetUseCase,
    @Inject(ASSETS_GET) private readonly obter: GetAssetUseCase,
    @Inject(ASSETS_SEARCH) private readonly pesquisar: SearchAssetsUseCase,
    @Inject(ASSETS_RETIRE) private readonly baixar: RetireAssetUseCase,
    @Inject(ASSETS_AVAILABILITY)
    private readonly disponibilidade: CheckAvailabilityUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('assets.asset.manage')
  @ApiOperation({
    operationId: 'registerAsset',
    summary: 'Cadastra um equipamento no patrimônio da empresa',
  })
  @ApiZodBody(cadastrarAtivoSchema)
  @ApiZodResponse(201, ativoResposta, 'Ativo cadastrado.')
  @ApiZodResponse(409, problemaSchema, 'Já existe ativo com este código.')
  @ApiErrosPadrao()
  async criar(
    @Body(new ZodValidationPipe(cadastrarAtivoSchema))
    corpo: z.infer<typeof cadastrarAtivoSchema>,
  ) {
    const { tenantId } = requireAuth();
    const ativo = await this.cadastrar.execute({
      tenantId,
      code: corpo.code,
      name: corpo.name,
      category: corpo.category,
      serialNumber: corpo.serialNumber,
      acquiredOn: corpo.acquiredOn ? new Date(corpo.acquiredOn) : null,
      notes: corpo.notes,
    });
    // Recém-cadastrado não tem bloqueio: disponível por construção.
    return ativoJson({
      asset: ativo,
      availability: 'available',
      currentHold: null,
    });
  }

  @Get()
  @RequirePermissions('assets.asset.read')
  @ApiOperation({
    operationId: 'searchAssets',
    summary: 'Lista ativos por categoria, disponibilidade, código ou nome',
  })
  @ApiZodQuery(pesquisarAtivosSchema)
  @ApiZodResponse(200, ativosPaginados, 'Página de ativos.')
  @ApiErrosPadrao()
  async listar(
    @Query(new ZodValidationPipe(pesquisarAtivosSchema))
    consulta: z.infer<typeof pesquisarAtivosSchema>,
  ) {
    const { tenantId } = requireAuth();
    const resultado = await this.pesquisar.execute({
      tenantId,
      ...consulta,
      em: consulta.em ? new Date(consulta.em) : undefined,
    });
    return {
      items: resultado.items.map(ativoJson),
      total: resultado.total,
      limit: consulta.limit,
      offset: consulta.offset,
    };
  }

  @Get(':assetId')
  @RequirePermissions('assets.asset.read')
  @ApiOperation({
    operationId: 'getAsset',
    summary: 'Obtém um ativo com a situação atual e o histórico de bloqueios',
  })
  @ApiZodResponse(200, ativoComHistoricoResposta, 'Ativo encontrado.')
  @ApiErrosPadrao()
  async obterAtivo(@Param('assetId', ParseUUIDPipe) assetId: string) {
    const { tenantId } = requireAuth();
    const resultado = await this.obter.execute({ tenantId, assetId });
    return {
      ...ativoJson(resultado),
      history: resultado.history.map(bloqueioJson),
    };
  }

  @Get(':assetId/availability')
  @RequirePermissions('assets.asset.read')
  @ApiOperation({
    operationId: 'checkAssetAvailability',
    summary: 'Responde se o ativo está livre num período, e o que o ocupa',
  })
  @ApiZodQuery(consultarDisponibilidadeSchema)
  @ApiZodResponse(200, disponibilidadeResposta, 'Situação no período.')
  @ApiErrosPadrao()
  async consultarDisponibilidade(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Query(new ZodValidationPipe(consultarDisponibilidadeSchema))
    consulta: z.infer<typeof consultarDisponibilidadeSchema>,
  ) {
    const { tenantId } = requireAuth();
    return disponibilidadeJson(
      await this.disponibilidade.execute({
        tenantId,
        assetId,
        startsAt: new Date(consulta.startsAt),
        endsAt: new Date(consulta.endsAt),
      }),
    );
  }

  @Post(':assetId')
  @HttpCode(200)
  @RequirePermissions('assets.asset.manage')
  @ApiOperation({
    operationId: 'updateAsset',
    summary: 'Corrige o cadastro de um ativo em operação',
  })
  @ApiZodBody(atualizarAtivoSchema)
  @ApiZodResponse(200, ativoResposta, 'Ativo atualizado.')
  @ApiErrosPadrao()
  async atualizarAtivo(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body(new ZodValidationPipe(atualizarAtivoSchema))
    corpo: z.infer<typeof atualizarAtivoSchema>,
  ) {
    const { tenantId } = requireAuth();
    const ativo = await this.atualizar.execute({
      tenantId,
      assetId,
      ...corpo,
      acquiredOn: corpo.acquiredOn ? new Date(corpo.acquiredOn) : undefined,
    });
    // A situação vem de outra leitura; aqui devolvemos o cadastro corrigido.
    return ativoJson(await this.comSituacao(tenantId, ativo.id));
  }

  @Post(':assetId/retire')
  @HttpCode(200)
  @RequirePermissions('assets.asset.retire')
  @ApiOperation({
    operationId: 'retireAsset',
    summary: 'Dá baixa definitiva no ativo (venda, perda ou fim de vida)',
  })
  @ApiZodBody(baixarAtivoSchema)
  @ApiZodResponse(200, ativoResposta, 'Ativo baixado.')
  @ApiZodResponse(409, problemaSchema, 'O ativo tem bloqueio em vigor agora.')
  @ApiErrosPadrao()
  async baixarAtivo(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body(new ZodValidationPipe(baixarAtivoSchema))
    corpo: z.infer<typeof baixarAtivoSchema>,
  ) {
    const { tenantId } = requireAuth();
    const ativo = await this.baixar.execute({
      tenantId,
      assetId,
      reason: corpo.reason,
    });
    return ativoJson({
      asset: ativo,
      availability: 'retired',
      currentHold: null,
    });
  }

  /** Relê o ativo com a situação derivada, para a resposta não mentir. */
  private comSituacao(tenantId: string, assetId: string) {
    return this.obter.execute({ tenantId, assetId, historicoLimite: 1 });
  }
}
