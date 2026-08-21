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
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import type {
  CreateProposalUseCase,
  DecideProposalUseCase,
  GetProposalUseCase,
  SearchProposalsUseCase,
  SendProposalUseCase,
  UpdateProposalUseCase,
} from '../../application/proposals.use-cases';
import {
  COMMERCIAL_CREATE_PROPOSAL,
  COMMERCIAL_DECIDE_PROPOSAL,
  COMMERCIAL_GET_PROPOSAL,
  COMMERCIAL_SEARCH_PROPOSALS,
  COMMERCIAL_SEND_PROPOSAL,
  COMMERCIAL_UPDATE_PROPOSAL,
} from '../../commercial.tokens';

import {
  atualizarPropostaSchema,
  criarPropostaSchema,
  pesquisarPropostasSchema,
} from './dto';
import { propostaJson } from './presenters';
import { propostaResposta, propostasPaginadas } from './responses';

/** Propostas comerciais: elaborar, enviar e registrar a decisão do cliente. */
@ApiTags('Comercial — Propostas')
@ApiBearerAuth()
@Controller('api/v1/commercial/proposals')
export class CommercialProposalsController {
  constructor(
    @Inject(COMMERCIAL_CREATE_PROPOSAL)
    private readonly criar: CreateProposalUseCase,
    @Inject(COMMERCIAL_UPDATE_PROPOSAL)
    private readonly atualizar: UpdateProposalUseCase,
    @Inject(COMMERCIAL_GET_PROPOSAL)
    private readonly obter: GetProposalUseCase,
    @Inject(COMMERCIAL_SEARCH_PROPOSALS)
    private readonly pesquisar: SearchProposalsUseCase,
    @Inject(COMMERCIAL_SEND_PROPOSAL)
    private readonly enviar: SendProposalUseCase,
    @Inject(COMMERCIAL_DECIDE_PROPOSAL)
    private readonly decidir: DecideProposalUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('commercial.proposal.create')
  @ApiOperation({
    operationId: 'createProposal',
    summary: 'Cria uma proposta em rascunho para um cliente',
  })
  @ApiZodBody(criarPropostaSchema)
  @ApiZodResponse(201, propostaResposta, 'Proposta criada.')
  @ApiZodResponse(404, problemaSchema, 'Cliente inexistente nesta empresa.')
  @ApiErrosPadrao()
  async criarProposta(
    @Body(new ZodValidationPipe(criarPropostaSchema))
    corpo: z.infer<typeof criarPropostaSchema>,
  ) {
    const { tenantId } = requireAuth();
    const proposta = await this.criar.execute({
      tenantId,
      customerId: corpo.customerId,
      title: corpo.title,
      currency: corpo.currency,
      validUntil: new Date(corpo.validUntil),
      notes: corpo.notes,
      items: corpo.items,
    });
    return propostaJson(proposta);
  }

  @Get()
  @RequirePermissions('commercial.proposal.read')
  @ApiOperation({
    operationId: 'searchProposals',
    summary: 'Lista propostas por cliente, situação ou título',
  })
  @ApiZodQuery(pesquisarPropostasSchema)
  @ApiZodResponse(200, propostasPaginadas, 'Página de propostas.')
  @ApiErrosPadrao()
  async listar(
    @Query(new ZodValidationPipe(pesquisarPropostasSchema))
    consulta: z.infer<typeof pesquisarPropostasSchema>,
  ) {
    const { tenantId } = requireAuth();
    const resultado = await this.pesquisar.execute({ tenantId, ...consulta });
    return {
      items: resultado.items.map((proposta) => propostaJson(proposta)),
      total: resultado.total,
      limit: consulta.limit,
      offset: consulta.offset,
    };
  }

  @Get(':proposalId')
  @RequirePermissions('commercial.proposal.read')
  @ApiOperation({
    operationId: 'getProposal',
    summary: 'Obtém uma proposta com itens e total',
  })
  @ApiZodResponse(200, propostaResposta, 'Proposta encontrada.')
  @ApiErrosPadrao()
  async obterProposta(@Param('proposalId', ParseUUIDPipe) proposalId: string) {
    const { tenantId } = requireAuth();
    const { proposal, customerName } = await this.obter.execute({
      tenantId,
      proposalId,
    });
    return propostaJson(proposal, customerName);
  }

  @Patch(':proposalId')
  @RequirePermissions('commercial.proposal.update')
  @ApiOperation({
    operationId: 'updateProposal',
    summary: 'Altera uma proposta ainda em rascunho',
  })
  @ApiZodBody(atualizarPropostaSchema)
  @ApiZodResponse(200, propostaResposta, 'Proposta atualizada.')
  @ApiZodResponse(409, problemaSchema, 'A proposta não é mais editável.')
  @ApiErrosPadrao()
  async atualizarProposta(
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body(new ZodValidationPipe(atualizarPropostaSchema))
    corpo: z.infer<typeof atualizarPropostaSchema>,
  ) {
    const { tenantId } = requireAuth();
    const proposta = await this.atualizar.execute({
      tenantId,
      proposalId,
      title: corpo.title,
      notes: corpo.notes,
      validUntil: corpo.validUntil ? new Date(corpo.validUntil) : undefined,
      items: corpo.items,
    });
    return propostaJson(proposta);
  }

  @Post(':proposalId/send')
  @HttpCode(200)
  @RequirePermissions('commercial.proposal.send')
  @ApiOperation({
    operationId: 'sendProposal',
    summary: 'Envia a proposta ao cliente (congela os valores)',
  })
  @ApiZodResponse(200, propostaResposta, 'Proposta enviada.')
  @ApiZodResponse(409, problemaSchema, 'Proposta vazia ou fora do rascunho.')
  @ApiErrosPadrao()
  async enviarProposta(@Param('proposalId', ParseUUIDPipe) proposalId: string) {
    const { tenantId } = requireAuth();
    return propostaJson(await this.enviar.execute({ tenantId, proposalId }));
  }

  @Post(':proposalId/accept')
  @HttpCode(200)
  @RequirePermissions('commercial.proposal.approve')
  @ApiOperation({
    operationId: 'acceptProposal',
    summary: 'Registra o aceite do cliente',
  })
  @ApiZodResponse(200, propostaResposta, 'Proposta aceita.')
  @ApiZodResponse(409, problemaSchema, 'Proposta vencida ou não enviada.')
  @ApiErrosPadrao()
  async aceitar(@Param('proposalId', ParseUUIDPipe) proposalId: string) {
    const { tenantId } = requireAuth();
    return propostaJson(await this.decidir.accept({ tenantId, proposalId }));
  }

  @Post(':proposalId/reject')
  @HttpCode(200)
  @RequirePermissions('commercial.proposal.approve')
  @ApiOperation({
    operationId: 'rejectProposal',
    summary: 'Registra a recusa do cliente',
  })
  @ApiZodResponse(200, propostaResposta, 'Proposta recusada.')
  @ApiErrosPadrao()
  async recusar(@Param('proposalId', ParseUUIDPipe) proposalId: string) {
    const { tenantId } = requireAuth();
    return propostaJson(await this.decidir.reject({ tenantId, proposalId }));
  }
}
