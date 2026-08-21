import type { EventHandler, IntegrationEvent } from '@ecojotaduo/events';
import type { PluginRuntimeProvider } from '@ecojotaduo/plugin-sdk';

import type { SendNotificationUseCase } from '../../application/send-notification.use-case';
import type { ConfiguracaoDeNotificacoes } from '../../config';

/**
 * Avisa o webhook da empresa quando um equipamento sai ou volta.
 *
 * É o primeiro consumidor real de evento da plataforma, e ele mostra por que o
 * outbox existe: a chamada HTTP para fora acontece DEPOIS do commit, num
 * processo separado. Se o webhook do cliente estiver fora do ar, a devolução
 * do equipamento já está gravada — a entrega é reagendada com backoff e nada
 * na API trava esperando.
 *
 * Só age em empresa que habilitou o plugin: sem instalação, `carregar` recusa
 * e o handler simplesmente não faz nada. Habilitar/desabilitar continua sendo
 * o entitlement de sempre, sem `if` de exceção aqui.
 */
export class NotificadorDeLocacao implements EventHandler {
  readonly name = 'notifications-example.rental-notifier';
  readonly eventTypes = [
    'operations.rental.started.v1',
    'operations.rental.finished.v1',
  ] as const;

  constructor(
    private readonly notificar: SendNotificationUseCase,
    private readonly runtime: PluginRuntimeProvider<ConfiguracaoDeNotificacoes>,
  ) {}

  async handle(evento: IntegrationEvent): Promise<void> {
    const instalacao = await this.runtime
      .carregar({
        tenantId: evento.tenantId,
        // Ator de sistema: o efeito é da plataforma reagindo ao fato, não de
        // quem originou a ação.
        actorId: 'outbox-dispatcher',
        // Sem entitlements: o plugin age com a INTERSEÇÃO entre o que a
        // instalação concedeu e o que chega aqui, então este handler fica
        // com o mínimo. É por isso que a notificação não busca o nome do
        // cliente — ela se basta com o que veio no próprio evento, e não
        // precisa de `crm.customer.read`.
        entitlements: [],
      })
      .catch(() => null);
    // Empresa sem o plugin habilitado: nada a notificar, e não é erro — o
    // evento segue como entregue para este handler.
    if (!instalacao) {
      return;
    }

    await this.notificar.execute({
      runtime: instalacao,
      message: this.mensagem(evento),
    });
  }

  private mensagem(evento: IntegrationEvent): string {
    const equipamento = comoTexto(evento.payload.assetCode) ?? 'equipamento';
    const numero = comoTexto(evento.payload.number) ?? '?';

    if (evento.type === 'operations.rental.started.v1') {
      return `Locação nº ${numero}: ${equipamento} saiu para o cliente.`;
    }

    const atraso = Number(evento.payload.overdueDays ?? 0);
    const sufixo =
      atraso > 0
        ? ` com ${atraso} ${atraso === 1 ? 'dia' : 'dias'} de atraso`
        : '';
    return `Locação nº ${numero}: ${equipamento} foi devolvido${sufixo}.`;
  }
}

/** O payload do evento é JSON: nada garante o tipo do que veio. */
function comoTexto(valor: unknown): string | null {
  if (typeof valor === 'string') {
    return valor;
  }
  return typeof valor === 'number' ? String(valor) : null;
}
