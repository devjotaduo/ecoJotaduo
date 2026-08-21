import {
  ApiErrosPadrao,
  ApiZodBody,
  ApiZodResponse,
  problemaSchema,
  RequirePermissions,
  ZodValidationPipe,
} from '@ecojotaduo/http-kit';
import type { PluginRuntimeProvider } from '@ecojotaduo/plugin-sdk';
import { requireAuth } from '@ecojotaduo/tenant-context';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { SendNotificationUseCase } from '../../application/send-notification.use-case';
import type { ConfiguracaoDeNotificacoes } from '../../config';
import {
  NOTIFICATIONS_RUNTIME,
  NOTIFICATIONS_SEND,
} from '../../notifications.tokens';

export const enviarMensagemSchema = z.object({
  message: z.string().min(1).max(2000),
  /** Quando informado, o plugin cita o cliente — e precisa da permissão. */
  customerId: z.uuid().nullish(),
});

const entregaResposta = z.object({
  deliveredAt: z.iso.datetime(),
  status: z.number().int(),
  customerName: z.string().nullable(),
});

/**
 * Borda REST do plugin.
 *
 * A rota exige `plugin.notifications-example.message.send`. Essa permissão só
 * é concedível quando o plugin está HABILITADO na empresa: o entitlement
 * `plugin.notifications-example` entra no grant a partir da instalação ativa
 * (ver `ListEnabledPluginsUseCase`). Desabilitar derruba a rota sem tocar em
 * papel nem em código.
 */
@ApiTags('Plugin — Notificações (exemplo)')
@ApiBearerAuth()
@Controller('api/v1/plugins/notifications-example')
export class NotificationsController {
  constructor(
    @Inject(NOTIFICATIONS_SEND)
    private readonly enviar: SendNotificationUseCase,
    @Inject(NOTIFICATIONS_RUNTIME)
    private readonly runtime: PluginRuntimeProvider<ConfiguracaoDeNotificacoes>,
  ) {}

  @Post('messages')
  @HttpCode(202)
  @RequirePermissions('plugin.notifications-example.message.send')
  @ApiOperation({
    operationId: 'sendNotificationMessage',
    summary: 'Entrega uma mensagem no webhook configurado pela empresa',
  })
  @ApiZodBody(enviarMensagemSchema)
  @ApiZodResponse(202, entregaResposta, 'Mensagem entregue ao destino.')
  @ApiZodResponse(409, problemaSchema, 'O destino recusou a entrega.')
  @ApiErrosPadrao()
  async enviarMensagem(
    @Body(new ZodValidationPipe(enviarMensagemSchema))
    corpo: z.infer<typeof enviarMensagemSchema>,
  ) {
    const { tenantId, actor, entitlements } = requireAuth();
    const runtime = await this.runtime.carregar({
      tenantId,
      actorId: actor.id,
      entitlements,
    });
    return this.enviar.execute({
      runtime,
      message: corpo.message,
      customerId: corpo.customerId,
    });
  }
}
