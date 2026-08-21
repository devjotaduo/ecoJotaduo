import {
  authenticateContext,
  createContext,
  runWithContext,
  toTenantId,
} from '@ecojotaduo/tenant-context';

import type { DrizzleOutbox } from './drizzle';
import {
  handlerAtende,
  type EventHandler,
  type IntegrationEvent,
} from './index';

/**
 * Entrega os eventos do outbox aos handlers registrados.
 *
 * Semântica: **at-least-once**. Um evento pode chegar duas vezes ao mesmo
 * handler se o processo morrer entre causar o efeito e registrar a entrega —
 * por isso handler idempotente é requisito, não recomendação. O registro por
 * handler evita o caso comum (retry repetindo quem já deu certo), não todos.
 *
 * Falha de entrega NÃO desfaz a transação de negócio: quando o dispatcher
 * roda, a escrita original já foi confirmada há muito. É essa separação que
 * faz uma integração instável não derrubar a API.
 */

export interface OpcoesDoDispatcher {
  /** Eventos por empresa em cada ciclo. */
  readonly tamanhoDoLote?: number;
  /** Tentativas antes de declarar o evento morto. */
  readonly maximoDeTentativas?: number;
  /** Primeiro adiamento, em milissegundos; dobra a cada falha. */
  readonly backoffBaseMs?: number;
  /** Teto do adiamento — sem ele, a espera cresceria sem limite. */
  readonly backoffMaximoMs?: number;
}

export interface ResumoDoCiclo {
  readonly tenants: number;
  readonly entregues: number;
  readonly falhados: number;
  readonly mortos: number;
}

const PADRAO = {
  tamanhoDoLote: 50,
  maximoDeTentativas: 6,
  backoffBaseMs: 5_000,
  backoffMaximoMs: 30 * 60 * 1000,
};

export class OutboxDispatcher {
  private readonly opcoes: Required<OpcoesDoDispatcher>;

  constructor(
    private readonly outbox: DrizzleOutbox,
    private readonly handlers: readonly EventHandler[],
    opcoes: OpcoesDoDispatcher = {},
  ) {
    this.opcoes = { ...PADRAO, ...opcoes };
  }

  /** Um ciclo completo: todas as empresas com pendência, um lote cada. */
  async processarCiclo(): Promise<ResumoDoCiclo> {
    const tenants = await this.outbox.tenantsComPendencia();
    let entregues = 0;
    let falhados = 0;
    let mortos = 0;

    for (const tenantId of tenants) {
      const resumo = await this.processarTenant(tenantId);
      entregues += resumo.entregues;
      falhados += resumo.falhados;
      mortos += resumo.mortos;
    }

    return { tenants: tenants.length, entregues, falhados, mortos };
  }

  async processarTenant(
    tenantId: string,
  ): Promise<Omit<ResumoDoCiclo, 'tenants'>> {
    const lote = await this.outbox.lote(tenantId, this.opcoes.tamanhoDoLote);
    let entregues = 0;
    let falhados = 0;
    let mortos = 0;

    for (const evento of lote) {
      const resultado = await this.entregar(evento);
      if (resultado === 'entregue') entregues += 1;
      if (resultado === 'adiado') falhados += 1;
      if (resultado === 'morto') mortos += 1;
    }

    return { entregues, falhados, mortos };
  }

  private async entregar(
    evento: IntegrationEvent,
  ): Promise<'entregue' | 'adiado' | 'morto'> {
    const jaEntregues = await this.outbox.entreguesA(
      evento.tenantId,
      evento.id,
    );
    const pendentes = this.handlers.filter(
      (handler) =>
        handlerAtende(handler, evento.type) &&
        !jaEntregues.includes(handler.name),
    );

    const falhas: string[] = [];
    for (const handler of pendentes) {
      try {
        // O handler roda no contexto da empresa dona do evento, como ator de
        // sistema: ele age em nome da plataforma, não de quem disparou o fato.
        await this.comContextoDoEvento(evento, () => handler.handle(evento));
        await this.outbox.registrarEntrega(
          evento.tenantId,
          evento.id,
          handler.name,
        );
      } catch (erro) {
        falhas.push(`${handler.name}: ${mensagem(erro)}`);
      }
    }

    if (falhas.length === 0) {
      await this.outbox.concluir(evento.tenantId, evento.id);
      return 'entregue';
    }

    const tentativas = evento.attempts + 1;
    const desistir = tentativas >= this.opcoes.maximoDeTentativas;
    await this.outbox.adiar({
      tenantId: evento.tenantId,
      eventId: evento.id,
      tentativas,
      erro: falhas.join(' | '),
      esperaMs: desistir ? null : this.espera(tentativas),
    });
    return desistir ? 'morto' : 'adiado';
  }

  /** Backoff exponencial com teto. */
  private espera(tentativas: number): number {
    return Math.min(
      this.opcoes.backoffBaseMs * 2 ** (tentativas - 1),
      this.opcoes.backoffMaximoMs,
    );
  }

  /**
   * Recria o contexto para o handler: mesma empresa, mesma correlação da
   * requisição que gerou o fato, canal `job`. Sem isto, o handler não teria
   * como escrever no banco — todo acesso passa pelo contexto autenticado — e a
   * trilha perderia o fio entre a ação original e o efeito assíncrono.
   */
  private comContextoDoEvento<T>(
    evento: IntegrationEvent,
    fn: () => Promise<T>,
  ): Promise<T> {
    const contexto = createContext('job', evento.correlationId ?? undefined);
    return runWithContext(contexto, () => {
      authenticateContext(contexto, {
        tenantId: toTenantId(evento.tenantId),
        // Ator de sistema: o handler tem os poderes da plataforma dentro
        // daquela empresa, e não os de quem originou o evento. Sem `userId`,
        // porque nenhum usuário está por trás de um efeito assíncrono.
        actor: { kind: 'system', id: 'outbox-dispatcher' },
        permissions: ['*'],
        scopes: ['*'],
        entitlements: [],
      });
      return fn();
    });
  }
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

export type { EventHandler, IntegrationEvent };
