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
  CancelRentalUseCase,
  FinishRentalUseCase,
  GetRentalUseCase,
  ScheduleRentalUseCase,
  SearchRentalsUseCase,
  StartRentalUseCase,
} from '../../application/rentals.use-cases';
import {
  OPERATIONS_CANCEL,
  OPERATIONS_FINISH,
  OPERATIONS_GET,
  OPERATIONS_SCHEDULE,
  OPERATIONS_SEARCH,
  OPERATIONS_START,
} from '../../operations.tokens';

import {
  encerrarSchema,
  pesquisarLocacoesSchema,
  programarSchema,
} from './dto';
import { locacaoJson } from './presenters';
import { locacaoResposta, locacoesPaginadas } from './responses';

/** Locações: programar sob contrato, retirar, devolver e cancelar. */
@ApiTags('Operações')
@ApiBearerAuth()
@Controller('api/v1/operations/rentals')
export class RentalsController {
  constructor(
    @Inject(OPERATIONS_SCHEDULE)
    private readonly programar: ScheduleRentalUseCase,
    @Inject(OPERATIONS_GET) private readonly obter: GetRentalUseCase,
    @Inject(OPERATIONS_SEARCH)
    private readonly pesquisar: SearchRentalsUseCase,
    @Inject(OPERATIONS_START) private readonly retirar: StartRentalUseCase,
    @Inject(OPERATIONS_FINISH) private readonly devolver: FinishRentalUseCase,
    @Inject(OPERATIONS_CANCEL) private readonly cancelar: CancelRentalUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('operations.rental.create')
  @ApiOperation({
    operationId: 'scheduleRental',
    summary: 'Programa uma locação sob um contrato em vigor',
  })
  @ApiZodBody(programarSchema)
  @ApiZodResponse(201, locacaoResposta, 'Locação programada.')
  @ApiZodResponse(
    409,
    problemaSchema,
    'Contrato fora de vigor, período fora da vigência, ou equipamento já comprometido.',
  )
  @ApiErrosPadrao()
  async criar(
    @Body(new ZodValidationPipe(programarSchema))
    corpo: z.infer<typeof programarSchema>,
  ) {
    const { tenantId } = requireAuth();
    const locacao = await this.programar.execute({
      tenantId,
      contractId: corpo.contractId,
      assetId: corpo.assetId,
      startsAt: new Date(corpo.startsAt),
      endsAt: new Date(corpo.endsAt),
      notes: corpo.notes,
    });
    return locacaoJson(locacao);
  }

  @Get()
  @RequirePermissions('operations.rental.read')
  @ApiOperation({
    operationId: 'searchRentals',
    summary: 'Lista locações por contrato, cliente, equipamento ou situação',
  })
  @ApiZodQuery(pesquisarLocacoesSchema)
  @ApiZodResponse(200, locacoesPaginadas, 'Página de locações.')
  @ApiErrosPadrao()
  async listar(
    @Query(new ZodValidationPipe(pesquisarLocacoesSchema))
    consulta: z.infer<typeof pesquisarLocacoesSchema>,
  ) {
    const { tenantId } = requireAuth();
    const resultado = await this.pesquisar.execute({ tenantId, ...consulta });
    return {
      items: resultado.items.map(locacaoJson),
      total: resultado.total,
      limit: consulta.limit,
      offset: consulta.offset,
    };
  }

  @Get(':rentalId')
  @RequirePermissions('operations.rental.read')
  @ApiOperation({
    operationId: 'getRental',
    summary: 'Obtém uma locação com situação e dias de atraso',
  })
  @ApiZodResponse(200, locacaoResposta, 'Locação encontrada.')
  @ApiErrosPadrao()
  async obterLocacao(@Param('rentalId', ParseUUIDPipe) rentalId: string) {
    const { tenantId } = requireAuth();
    return locacaoJson(await this.obter.execute({ tenantId, rentalId }));
  }

  @Post(':rentalId/start')
  @HttpCode(200)
  @RequirePermissions('operations.rental.manage')
  @ApiOperation({
    operationId: 'startRental',
    summary: 'Registra a retirada: o equipamento saiu',
  })
  @ApiZodResponse(200, locacaoResposta, 'Locação em andamento.')
  @ApiZodResponse(409, problemaSchema, 'A locação não está programada.')
  @ApiErrosPadrao()
  async iniciar(@Param('rentalId', ParseUUIDPipe) rentalId: string) {
    const { tenantId } = requireAuth();
    return locacaoJson(await this.retirar.execute({ tenantId, rentalId }));
  }

  @Post(':rentalId/finish')
  @HttpCode(200)
  @RequirePermissions('operations.rental.manage')
  @ApiOperation({
    operationId: 'finishRental',
    summary: 'Registra a devolução e libera o equipamento no pátio',
  })
  @ApiZodBody(encerrarSchema)
  @ApiZodResponse(200, locacaoResposta, 'Locação encerrada.')
  @ApiErrosPadrao()
  async concluir(
    @Param('rentalId', ParseUUIDPipe) rentalId: string,
    @Body(new ZodValidationPipe(encerrarSchema))
    corpo: z.infer<typeof encerrarSchema>,
  ) {
    const { tenantId } = requireAuth();
    return locacaoJson(
      await this.devolver.execute({ tenantId, rentalId, reason: corpo.reason }),
    );
  }

  @Post(':rentalId/cancel')
  @HttpCode(200)
  @RequirePermissions('operations.rental.manage')
  @ApiOperation({
    operationId: 'cancelRental',
    summary: 'Cancela uma locação ainda não retirada e libera o equipamento',
  })
  @ApiZodBody(encerrarSchema)
  @ApiZodResponse(200, locacaoResposta, 'Locação cancelada.')
  @ApiZodResponse(409, problemaSchema, 'O equipamento já saiu.')
  @ApiErrosPadrao()
  async cancelarLocacao(
    @Param('rentalId', ParseUUIDPipe) rentalId: string,
    @Body(new ZodValidationPipe(encerrarSchema))
    corpo: z.infer<typeof encerrarSchema>,
  ) {
    const { tenantId } = requireAuth();
    return locacaoJson(
      await this.cancelar.execute({ tenantId, rentalId, reason: corpo.reason }),
    );
  }
}
