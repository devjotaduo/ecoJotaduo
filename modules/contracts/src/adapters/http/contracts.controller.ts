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
  ActivateContractUseCase,
  CloseContractUseCase,
  CreateContractUseCase,
  GetContractUseCase,
  SearchContractsUseCase,
} from '../../application/contracts.use-cases';
import {
  CONTRACTS_ACTIVATE,
  CONTRACTS_CLOSE,
  CONTRACTS_CREATE,
  CONTRACTS_GET,
  CONTRACTS_SEARCH,
} from '../../contracts.tokens';

import {
  encerrarSchema,
  formalizarSchema,
  pesquisarContratosSchema,
} from './dto';
import { contratoJson } from './presenters';
import { contratoResposta, contratosPaginados } from './responses';

/** Contratos: formalizar a partir da proposta aceita, ativar e encerrar. */
@ApiTags('Contratos')
@ApiBearerAuth()
@Controller('api/v1/contracts')
export class ContractsController {
  constructor(
    @Inject(CONTRACTS_CREATE)
    private readonly formalizar: CreateContractUseCase,
    @Inject(CONTRACTS_GET) private readonly obter: GetContractUseCase,
    @Inject(CONTRACTS_SEARCH)
    private readonly pesquisar: SearchContractsUseCase,
    @Inject(CONTRACTS_ACTIVATE)
    private readonly ativar: ActivateContractUseCase,
    @Inject(CONTRACTS_CLOSE) private readonly encerrar: CloseContractUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('contracts.contract.create')
  @ApiOperation({
    operationId: 'createContract',
    summary: 'Formaliza um contrato a partir de uma proposta aceita',
  })
  @ApiZodBody(formalizarSchema)
  @ApiZodResponse(201, contratoResposta, 'Contrato criado em rascunho.')
  @ApiZodResponse(409, problemaSchema, 'Proposta não aceita ou já contratada.')
  @ApiErrosPadrao()
  async criar(
    @Body(new ZodValidationPipe(formalizarSchema))
    corpo: z.infer<typeof formalizarSchema>,
  ) {
    const { tenantId } = requireAuth();
    const contrato = await this.formalizar.execute({
      tenantId,
      proposalId: corpo.proposalId,
      startsOn: new Date(corpo.startsOn),
      endsOn: new Date(corpo.endsOn),
      notes: corpo.notes,
    });
    return contratoJson(contrato);
  }

  @Get()
  @RequirePermissions('contracts.contract.read')
  @ApiOperation({
    operationId: 'searchContracts',
    summary: 'Lista contratos por cliente, situação ou título',
  })
  @ApiZodQuery(pesquisarContratosSchema)
  @ApiZodResponse(200, contratosPaginados, 'Página de contratos.')
  @ApiErrosPadrao()
  async listar(
    @Query(new ZodValidationPipe(pesquisarContratosSchema))
    consulta: z.infer<typeof pesquisarContratosSchema>,
  ) {
    const { tenantId } = requireAuth();
    const resultado = await this.pesquisar.execute({ tenantId, ...consulta });
    return {
      items: resultado.items.map(contratoJson),
      total: resultado.total,
      limit: consulta.limit,
      offset: consulta.offset,
    };
  }

  @Get(':contractId')
  @RequirePermissions('contracts.contract.read')
  @ApiOperation({
    operationId: 'getContract',
    summary: 'Obtém um contrato com vigência e situação',
  })
  @ApiZodResponse(200, contratoResposta, 'Contrato encontrado.')
  @ApiErrosPadrao()
  async obterContrato(@Param('contractId', ParseUUIDPipe) contractId: string) {
    const { tenantId } = requireAuth();
    return contratoJson(await this.obter.execute({ tenantId, contractId }));
  }

  @Post(':contractId/activate')
  @HttpCode(200)
  @RequirePermissions('contracts.contract.activate')
  @ApiOperation({
    operationId: 'activateContract',
    summary: 'Coloca o contrato em vigor',
  })
  @ApiZodResponse(200, contratoResposta, 'Contrato ativo.')
  @ApiZodResponse(409, problemaSchema, 'Fora do rascunho ou vigência vencida.')
  @ApiErrosPadrao()
  async ativarContrato(@Param('contractId', ParseUUIDPipe) contractId: string) {
    const { tenantId } = requireAuth();
    return contratoJson(await this.ativar.execute({ tenantId, contractId }));
  }

  @Post(':contractId/finish')
  @HttpCode(200)
  @RequirePermissions('contracts.contract.close')
  @ApiOperation({
    operationId: 'finishContract',
    summary: 'Encerra um contrato ativo',
  })
  @ApiZodBody(encerrarSchema)
  @ApiZodResponse(200, contratoResposta, 'Contrato encerrado.')
  @ApiErrosPadrao()
  async concluir(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body(new ZodValidationPipe(encerrarSchema))
    corpo: z.infer<typeof encerrarSchema>,
  ) {
    const { tenantId } = requireAuth();
    return contratoJson(
      await this.encerrar.finish({
        tenantId,
        contractId,
        reason: corpo.reason,
      }),
    );
  }

  @Post(':contractId/cancel')
  @HttpCode(200)
  @RequirePermissions('contracts.contract.close')
  @ApiOperation({
    operationId: 'cancelContract',
    summary: 'Cancela um contrato ativo antes do fim previsto',
  })
  @ApiZodBody(encerrarSchema)
  @ApiZodResponse(200, contratoResposta, 'Contrato cancelado.')
  @ApiErrosPadrao()
  async cancelar(
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body(new ZodValidationPipe(encerrarSchema))
    corpo: z.infer<typeof encerrarSchema>,
  ) {
    const { tenantId } = requireAuth();
    return contratoJson(
      await this.encerrar.cancel({
        tenantId,
        contractId,
        reason: corpo.reason,
      }),
    );
  }
}
