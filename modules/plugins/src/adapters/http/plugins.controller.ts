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
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import type {
  ChangePluginStatusUseCase,
  ConfigurePluginUseCase,
  InstallPluginUseCase,
  ListPluginsUseCase,
} from '../../application/manage-plugins.use-cases';
import {
  PLUGINS_CHANGE_STATUS,
  PLUGINS_CONFIGURE,
  PLUGINS_INSTALL,
  PLUGINS_LIST,
} from '../../plugins.tokens';

import { configurarSchema, instalarSchema } from './dto';
import { instalacaoJson, pluginJson } from './presenters';
import { catalogoResposta, instalacaoResposta } from './responses';

/**
 * Administração de plugins da empresa.
 *
 * Nenhuma rota devolve valor de segredo — a listagem mostra só as CHAVES já
 * configuradas. Uma vez enviado, um segredo só sai do banco para a memória do
 * próprio plugin, durante a chamada dele.
 */
@ApiTags('Plataforma — Plugins')
@ApiBearerAuth()
@Controller('api/v1/plugins')
export class PluginsController {
  constructor(
    @Inject(PLUGINS_LIST) private readonly listar: ListPluginsUseCase,
    @Inject(PLUGINS_INSTALL) private readonly instalar: InstallPluginUseCase,
    @Inject(PLUGINS_CONFIGURE)
    private readonly configurar: ConfigurePluginUseCase,
    @Inject(PLUGINS_CHANGE_STATUS)
    private readonly status: ChangePluginStatusUseCase,
  ) {}

  @Get()
  @RequirePermissions('platform.plugin.read')
  @ApiOperation({
    operationId: 'listPlugins',
    summary: 'Lista o catálogo de plugins e o estado da instalação na empresa',
  })
  @ApiZodResponse(200, catalogoResposta, 'Catálogo com o estado da empresa.')
  @ApiErrosPadrao()
  async catalogo() {
    const { tenantId } = requireAuth();
    const itens = await this.listar.execute({ tenantId });
    return { items: itens.map(pluginJson) };
  }

  @Post(':pluginId/install')
  @HttpCode(201)
  @RequirePermissions('platform.plugin.manage')
  @ApiOperation({
    operationId: 'installPlugin',
    summary: 'Instala um plugin na empresa, concedendo permissões',
  })
  @ApiZodBody(instalarSchema)
  @ApiZodResponse(201, instalacaoResposta, 'Plugin instalado.')
  @ApiZodResponse(409, problemaSchema, 'O plugin já está instalado.')
  @ApiErrosPadrao()
  async instalarPlugin(
    @Param('pluginId') pluginId: string,
    @Body(new ZodValidationPipe(instalarSchema))
    corpo: z.infer<typeof instalarSchema>,
  ) {
    const { tenantId } = requireAuth();
    const instalacao = await this.instalar.execute({
      tenantId,
      pluginId,
      grantedPermissions: corpo.grantedPermissions,
    });
    return instalacaoJson(instalacao);
  }

  @Post(':pluginId/configure')
  @HttpCode(200)
  @RequirePermissions('platform.plugin.manage')
  @ApiOperation({
    operationId: 'configurePlugin',
    summary: 'Grava a configuração e os segredos do plugin na empresa',
  })
  @ApiZodBody(configurarSchema)
  @ApiZodResponse(200, instalacaoResposta, 'Configuração aplicada.')
  @ApiErrosPadrao()
  async configurarPlugin(
    @Param('pluginId') pluginId: string,
    @Body(new ZodValidationPipe(configurarSchema))
    corpo: z.infer<typeof configurarSchema>,
  ) {
    const { tenantId } = requireAuth();
    const instalacao = await this.configurar.execute({
      tenantId,
      pluginId,
      config: corpo.config,
      secrets: corpo.secrets,
    });
    return instalacaoJson(instalacao);
  }

  @Post(':pluginId/enable')
  @HttpCode(200)
  @RequirePermissions('platform.plugin.manage')
  @ApiOperation({
    operationId: 'enablePlugin',
    summary: 'Habilita o plugin na empresa',
  })
  @ApiZodResponse(200, instalacaoResposta, 'Plugin habilitado.')
  @ApiZodResponse(409, problemaSchema, 'Falta configuração ou segredo.')
  @ApiErrosPadrao()
  async habilitar(@Param('pluginId') pluginId: string) {
    const { tenantId } = requireAuth();
    return instalacaoJson(await this.status.enable({ tenantId, pluginId }));
  }

  @Post(':pluginId/disable')
  @HttpCode(200)
  @RequirePermissions('platform.plugin.manage')
  @ApiOperation({
    operationId: 'disablePlugin',
    summary: 'Desabilita o plugin na empresa',
  })
  @ApiZodResponse(200, instalacaoResposta, 'Plugin desabilitado.')
  @ApiErrosPadrao()
  async desabilitar(@Param('pluginId') pluginId: string) {
    const { tenantId } = requireAuth();
    return instalacaoJson(await this.status.disable({ tenantId, pluginId }));
  }

  @Delete(':pluginId')
  @HttpCode(204)
  @RequirePermissions('platform.plugin.manage')
  @ApiOperation({
    operationId: 'uninstallPlugin',
    summary: 'Remove o plugin da empresa, apagando os segredos',
  })
  @ApiErrosPadrao()
  async desinstalar(@Param('pluginId') pluginId: string): Promise<void> {
    const { tenantId } = requireAuth();
    await this.status.uninstall({ tenantId, pluginId });
  }
}
