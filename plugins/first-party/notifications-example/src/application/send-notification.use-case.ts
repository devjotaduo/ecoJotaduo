import type { AuditLogger } from '@ecojotaduo/audit';
import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';
import {
  exigirPermissaoDoPlugin,
  type PluginRuntime,
} from '@ecojotaduo/plugin-sdk';

import {
  assinarEntrega,
  CABECALHO_ASSINATURA,
  CABECALHO_TIMESTAMP,
} from '../domain/assinatura';
import { destinoPublicoHttps, type PoliticaDeDestino } from '../domain/destino';
import type { ConfiguracaoDeNotificacoes } from '../config';

export class EntregaFalhouError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(detalhe: string) {
    super(`O destino não aceitou a notificação: ${detalhe}`);
  }
}

/**
 * Leitura de cliente que o plugin precisa para enriquecer a mensagem.
 *
 * É uma PORTA, não um import do módulo CRM: o plugin fala com a plataforma
 * por capacidade declarada, e quem liga a ponta é o composition root. Se um
 * dia este plugin virar externo (ADR-0005), o que muda é a implementação
 * desta interface — não o caso de uso.
 */
export interface LeitorDeClientes {
  nomeDoCliente(tenantId: string, customerId: string): Promise<string>;
}

export interface NotificacaoEnviada {
  readonly deliveredAt: string;
  readonly status: number;
  readonly customerName: string | null;
}

const TIMEOUT_MS = 5_000;

/**
 * Entrega uma mensagem no webhook configurado pela empresa.
 *
 * Três controles que não são opcionais neste caminho:
 * 1. a permissão `crm.customer.read` é conferida na chamada, contra o que foi
 *    concedido NA INSTALAÇÃO — não contra o que o usuário pode;
 * 2. o destino passa pela política anti-SSRF antes de qualquer conexão;
 * 3. o segredo assina e some — não vai para a resposta, para o log nem para a
 *    trilha de auditoria.
 */
export class SendNotificationUseCase {
  constructor(
    private readonly clientes: LeitorDeClientes,
    private readonly audit: AuditLogger,
    private readonly fetchDaCasa: typeof fetch = globalThis.fetch,
    private readonly politica: PoliticaDeDestino = destinoPublicoHttps,
  ) {}

  async execute(entrada: {
    runtime: PluginRuntime<ConfiguracaoDeNotificacoes>;
    message: string;
    customerId?: string | null;
  }): Promise<NotificacaoEnviada> {
    const { runtime } = entrada;

    let customerName: string | null = null;
    if (entrada.customerId) {
      // Lança ForbiddenError quando a instalação não concedeu — ou quando a
      // empresa cancelou o módulo CRM depois de conceder.
      exigirPermissaoDoPlugin(runtime, 'crm.customer.read');
      customerName = await this.clientes.nomeDoCliente(
        runtime.tenantId,
        entrada.customerId,
      );
    }

    const destino = new URL(runtime.config.webhookUrl);
    await this.politica(destino);

    const timestamp = Math.floor(Date.now() / 1000);
    const corpo = JSON.stringify({
      tenantId: runtime.tenantId,
      message: entrada.message,
      customer: customerName
        ? { id: entrada.customerId, name: customerName }
        : null,
      sentAt: new Date(timestamp * 1000).toISOString(),
    });

    const resposta = await this.entregar(destino, corpo, timestamp, runtime);

    await this.audit.record({
      action: 'plugin.notifications-example.message.sent',
      result: resposta.ok ? 'success' : 'error',
      resourceType: 'webhook',
      // O host, nunca a URL completa (caminho e query podem carregar token).
      metadata: { host: destino.host, status: resposta.status },
    });

    if (!resposta.ok) {
      throw new EntregaFalhouError(`respondeu ${resposta.status}.`);
    }

    return {
      deliveredAt: new Date().toISOString(),
      status: resposta.status,
      customerName,
    };
  }

  private async entregar(
    destino: URL,
    corpo: string,
    timestamp: number,
    runtime: PluginRuntime<ConfiguracaoDeNotificacoes>,
  ): Promise<Response> {
    try {
      return await this.fetchDaCasa(destino, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CABECALHO_TIMESTAMP]: String(timestamp),
          [CABECALHO_ASSINATURA]: assinarEntrega({
            corpo,
            timestamp,
            segredo: runtime.segredo('signingSecret'),
          }),
        },
        body: corpo,
        // Sem timeout, um destino que aceita a conexão e nunca responde
        // prenderia a requisição do usuário até o proxy desistir.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (erro) {
      // A causa real fica no erro original (que o filtro loga); a mensagem
      // devolvida não repete a URL nem o motivo detalhado da rede.
      throw new EntregaFalhouError(
        erro instanceof Error && erro.name === 'TimeoutError'
          ? 'não respondeu a tempo.'
          : 'não foi possível conectar.',
      );
    }
  }
}
