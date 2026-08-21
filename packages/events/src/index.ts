/**
 * Contrato de eventos de integração da plataforma.
 *
 * Casos de uso dependem apenas deste arquivo — a persistência vive em
 * `./drizzle` e a entrega em `./dispatcher`, como o `@ecojotaduo/audit` já faz.
 */

/** O que um caso de uso declara ter acontecido. */
export interface EventoParaPublicar {
  /** Fato no passado e versionado: `crm.customer.created.v1`. */
  readonly type: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  /**
   * O suficiente para o consumidor agir sem consultar de volta — e NUNCA
   * segredos, tokens ou o registro inteiro. O evento atravessa processos e
   * fica guardado; o que entra aqui vira histórico.
   */
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** O evento como ele sai do outbox, pronto para entrega. */
export interface IntegrationEvent extends EventoParaPublicar {
  readonly id: string;
  readonly tenantId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly actorKind: string | null;
  readonly actorId: string | null;
  /** Quantas entregas já falharam. Zero na primeira tentativa. */
  readonly attempts: number;
}

export interface EventPublisher {
  /**
   * Grava o evento para entrega posterior.
   *
   * Dentro de uma unidade de trabalho, participa da MESMA transação do dado —
   * que é a única forma de o outbox significar alguma coisa. Tenant, ator e
   * correlação vêm do contexto, não do chamador.
   */
  publish(evento: EventoParaPublicar): Promise<void>;
}

/**
 * Um consumidor de eventos.
 *
 * `name` identifica o handler no registro de entregas: um retry não repete
 * quem já deu certo. Ainda assim, **escreva handlers idempotentes** — a
 * entrega é at-least-once, e um processo pode morrer depois de causar o efeito
 * e antes de registrar que o causou.
 */
export interface EventHandler {
  readonly name: string;
  /** Tipos que este handler consome. `*` no fim casa prefixo: `crm.*`. */
  readonly eventTypes: readonly string[];
  handle(evento: IntegrationEvent): Promise<void>;
}

/** O handler consome este tipo de evento? */
export function handlerAtende(handler: EventHandler, tipo: string): boolean {
  return handler.eventTypes.some((padrao) =>
    padrao.endsWith('*')
      ? tipo.startsWith(padrao.slice(0, -1))
      : padrao === tipo,
  );
}

/** Publisher nulo, para testes que não exercitam eventos. */
export class NoopEventPublisher implements EventPublisher {
  readonly eventos: EventoParaPublicar[] = [];

  publish(evento: EventoParaPublicar): Promise<void> {
    this.eventos.push(evento);
    return Promise.resolve();
  }
}
