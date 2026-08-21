import type { Env } from '@ecojotaduo/config';
import { OutboxDispatcher } from '@ecojotaduo/events/dispatcher';
import {
  criarNucleo,
  type NucleoDaPlataforma,
} from '@ecojotaduo/platform-core';

/**
 * Worker de fundo.
 *
 * Monta o MESMO núcleo da API REST e do gateway MCP — `criarNucleo` — e liga
 * só a borda: um laço que drena o outbox. Nenhuma regra de negócio aqui;
 * quem decide o que fazer com um fato são os handlers registrados na
 * composição, e eles chamam os mesmos casos de uso de sempre.
 */

export interface OpcoesDoWorker {
  /** Intervalo entre ciclos quando não há nada a fazer. */
  readonly intervaloOciosoMs?: number;
  /** Intervalo depois de um ciclo que entregou algo — drena a fila mais rápido. */
  readonly intervaloAtivoMs?: number;
}

export interface Worker {
  readonly nucleo: NucleoDaPlataforma;
  readonly dispatcher: OutboxDispatcher;
  /** Roda até `parar()` ser chamado. */
  iniciar(): Promise<void>;
  parar(): void;
}

const PADRAO = { intervaloOciosoMs: 2_000, intervaloAtivoMs: 100 };

export function criarWorker(env: Env, opcoes: OpcoesDoWorker = {}): Worker {
  const nucleo = criarNucleo(env);
  const dispatcher = new OutboxDispatcher(
    nucleo.outbox,
    nucleo.handlersDeEventos,
  );
  const intervalos = { ...PADRAO, ...opcoes };
  let rodando = false;

  return {
    nucleo,
    dispatcher,

    async iniciar(): Promise<void> {
      rodando = true;
      while (rodando) {
        // Um ciclo que falha inteiro (banco fora do ar, por exemplo) não pode
        // derrubar o worker: ele espera e tenta de novo. O que trava aqui é
        // um processo que morre em silêncio e para de drenar a fila.
        const resumo = await dispatcher
          .processarCiclo()
          .catch(() => ({ tenants: 0, entregues: 0, falhados: 0, mortos: 0 }));

        const espera =
          resumo.entregues > 0
            ? intervalos.intervaloAtivoMs
            : intervalos.intervaloOciosoMs;
        await dormir(espera);
      }
    },

    parar(): void {
      rodando = false;
    },
  };
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}
