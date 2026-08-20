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
  CreateCustomerUseCase,
  GetCustomerUseCase,
  SearchCustomersUseCase,
  UpdateCustomerUseCase,
} from '../../application/customers.use-cases';
import type {
  AddCustomerNoteUseCase,
  ListCustomerNotesUseCase,
} from '../../application/notes.use-cases';
import {
  CRM_ADD_NOTE,
  CRM_CREATE_CUSTOMER,
  CRM_GET_CUSTOMER,
  CRM_LIST_NOTES,
  CRM_SEARCH_CUSTOMERS,
  CRM_UPDATE_CUSTOMER,
} from '../../crm.tokens';

import {
  adicionarNotaSchema,
  atualizarClienteSchema,
  criarClienteSchema,
  paginaSchema,
  pesquisarClientesSchema,
} from './dto';
import { clienteJson, historicoJson, notaJson } from './presenters';
import {
  clienteComHistoricoResposta,
  clienteResposta,
  clientesPaginados,
  notaResposta,
  notasPaginadas,
} from './responses';

/**
 * Borda REST do CRM.
 *
 * O controller não decide nada: valida a entrada, pega tenant e ator do
 * contexto autenticado e delega ao caso de uso — o mesmo que o adaptador MCP
 * chama. É o que sustenta o critério "REST e MCP executam o mesmo caso de uso".
 */
@ApiTags('CRM — Clientes')
@ApiBearerAuth()
@Controller('api/v1/crm/customers')
export class CrmCustomersController {
  constructor(
    @Inject(CRM_CREATE_CUSTOMER) private readonly criar: CreateCustomerUseCase,
    @Inject(CRM_UPDATE_CUSTOMER)
    private readonly atualizar: UpdateCustomerUseCase,
    @Inject(CRM_GET_CUSTOMER) private readonly obter: GetCustomerUseCase,
    @Inject(CRM_SEARCH_CUSTOMERS)
    private readonly pesquisar: SearchCustomersUseCase,
    @Inject(CRM_ADD_NOTE)
    private readonly adicionarNota: AddCustomerNoteUseCase,
    @Inject(CRM_LIST_NOTES)
    private readonly listarNotas: ListCustomerNotesUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('crm.customer.create')
  @ApiOperation({
    operationId: 'crmCreateCustomer',
    summary: 'Cadastra um cliente',
  })
  @ApiZodBody(criarClienteSchema)
  @ApiZodResponse(201, clienteResposta, 'Cliente cadastrado.')
  @ApiZodResponse(409, problemaSchema, 'Documento já cadastrado nesta empresa.')
  @ApiErrosPadrao()
  async criarCliente(
    @Body(new ZodValidationPipe(criarClienteSchema))
    corpo: z.infer<typeof criarClienteSchema>,
  ) {
    const { tenantId } = requireAuth();
    const cliente = await this.criar.execute({ tenantId, ...corpo });
    return clienteJson(cliente);
  }

  @Get()
  @RequirePermissions('crm.customer.read')
  @ApiOperation({
    operationId: 'crmSearchCustomers',
    summary: 'Pesquisa clientes',
  })
  @ApiZodQuery(pesquisarClientesSchema)
  @ApiZodResponse(200, clientesPaginados, 'Página de clientes.')
  @ApiErrosPadrao()
  async pesquisarClientes(
    @Query(new ZodValidationPipe(pesquisarClientesSchema))
    consulta: z.infer<typeof pesquisarClientesSchema>,
  ) {
    const { tenantId } = requireAuth();
    const resultado = await this.pesquisar.execute({ tenantId, ...consulta });

    return {
      items: resultado.items.map(clienteJson),
      total: resultado.total,
      limit: consulta.limit,
      offset: consulta.offset,
    };
  }

  @Get(':customerId')
  @RequirePermissions('crm.customer.read')
  @ApiOperation({
    operationId: 'crmGetCustomer',
    summary: 'Obtém cliente com histórico',
  })
  @ApiZodResponse(200, clienteComHistoricoResposta, 'Cliente e linha do tempo.')
  @ApiErrosPadrao()
  async obterCliente(@Param('customerId', ParseUUIDPipe) customerId: string) {
    const { tenantId } = requireAuth();
    const { customer, timeline } = await this.obter.execute({
      tenantId,
      customerId,
    });

    return { ...clienteJson(customer), timeline: timeline.map(historicoJson) };
  }

  @Post(':customerId')
  @RequirePermissions('crm.customer.update')
  @ApiOperation({
    operationId: 'crmUpdateCustomer',
    summary: 'Atualiza um cliente',
  })
  @ApiZodBody(atualizarClienteSchema)
  @ApiZodResponse(200, clienteResposta, 'Cliente atualizado.')
  @ApiErrosPadrao()
  async atualizarCliente(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body(new ZodValidationPipe(atualizarClienteSchema))
    corpo: z.infer<typeof atualizarClienteSchema>,
  ) {
    const { tenantId } = requireAuth();
    const cliente = await this.atualizar.execute({
      tenantId,
      customerId,
      ...corpo,
    });
    return clienteJson(cliente);
  }

  @Post(':customerId/notes')
  @HttpCode(201)
  @RequirePermissions('crm.note.create')
  @ApiOperation({
    operationId: 'crmAddCustomerNote',
    summary: 'Registra nota no histórico',
  })
  @ApiZodBody(adicionarNotaSchema)
  @ApiZodResponse(201, notaResposta, 'Nota registrada.')
  @ApiErrosPadrao()
  async criarNota(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body(new ZodValidationPipe(adicionarNotaSchema))
    corpo: z.infer<typeof adicionarNotaSchema>,
  ) {
    const auth = requireAuth();
    const nota = await this.adicionarNota.execute({
      tenantId: auth.tenantId,
      customerId,
      body: corpo.body,
      authorId: auth.actor.id,
    });
    return notaJson(nota);
  }

  @Get(':customerId/notes')
  @RequirePermissions('crm.customer.read')
  @ApiOperation({
    operationId: 'crmListCustomerNotes',
    summary: 'Lista notas do cliente',
  })
  @ApiZodQuery(paginaSchema)
  @ApiZodResponse(200, notasPaginadas, 'Página de notas.')
  @ApiErrosPadrao()
  async listarNotasDoCliente(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query(new ZodValidationPipe(paginaSchema))
    consulta: z.infer<typeof paginaSchema>,
  ) {
    const { tenantId } = requireAuth();
    const resultado = await this.listarNotas.execute({
      tenantId,
      customerId,
      ...consulta,
    });

    return {
      items: resultado.items.map(notaJson),
      total: resultado.total,
      limit: consulta.limit,
      offset: consulta.offset,
    };
  }
}
