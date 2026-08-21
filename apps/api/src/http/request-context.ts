import { randomUUID } from 'node:crypto';

import {
  CABECALHOS_DE_SEGURANCA,
  HSTS,
  linhaDeRequisicao,
} from '@ecojotaduo/platform-kernel';
import {
  createContext,
  getContext,
  runWithContext,
} from '@ecojotaduo/tenant-context';
import type { FastifyInstance } from 'fastify';

const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Abre o contexto da requisição antes de qualquer guard ou handler.
 *
 * Usa hook nativo do Fastify (em vez de middleware) porque o
 * AsyncLocalStorage precisa envolver toda a cadeia — é o que garante que
 * nenhum caso de uso rode sem contexto e que tenant e correlação apareçam em
 * log, auditoria e persistência.
 *
 * Fica fora do `main.ts` de propósito: o composition root do MCP gateway
 * reutiliza esta função, e importar o `main` traria o efeito colateral de
 * subir o servidor.
 */
export function registrarContextoDeRequisicao(
  instancia: FastifyInstance,
): void {
  instancia.addHook('onRequest', (requisicao, resposta, done) => {
    const informado = requisicao.headers[CORRELATION_HEADER];
    const correlationId =
      typeof informado === 'string' && informado.length <= 64
        ? informado
        : randomUUID();

    void resposta.header(CORRELATION_HEADER, correlationId);
    for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
      void resposta.header(nome, valor);
    }
    runWithContext(createContext('rest', correlationId), done);
  });
}

/**
 * Uma linha de log por requisição, com quem, de qual empresa, o quê, quanto
 * tempo e com que resultado — o critério de aceite da Fase 10.
 *
 * A trilha de auditoria responde isso para ações de negócio; esta linha
 * responde para o resto: leitura, erro, recusa, requisição que nem chegou ao
 * caso de uso. Sem ela, "a API está lenta" não tem como virar "esta rota,
 * desta empresa, está lenta".
 *
 * `onResponse` e não `onSend`: aqui o status final já é conhecido, inclusive
 * quando um filtro de exceção trocou a resposta pelo caminho.
 */
export function registrarLogDeRequisicao(instancia: FastifyInstance): void {
  instancia.addHook('onResponse', (requisicao, resposta, done) => {
    const contexto = getContext();
    const auth = contexto?.auth;

    instancia.log.info(
      linhaDeRequisicao({
        method: requisicao.method,
        // A rota REGISTRADA, e não a url: `/customers/:id` agrupa, `/customers/abc`
        // cria uma série de um item só e some no meio das outras.
        route: requisicao.routeOptions?.url ?? requisicao.url,
        status: resposta.statusCode,
        durationMs: Math.round(resposta.elapsedTime),
        correlationId: contexto?.correlationId ?? '',
        tenantId: auth?.tenantId,
        actorKind: auth?.actor.kind,
        actorId: auth?.actor.id,
        channel: contexto?.channel ?? 'rest',
      }),
    );
    done();
  });
}

/** HSTS só sob HTTPS: em HTTP puro o navegador ignora, e em dev atrapalha. */
export function registrarHsts(instancia: FastifyInstance): void {
  instancia.addHook('onRequest', (_requisicao, resposta, done) => {
    void resposta.header('strict-transport-security', HSTS);
    done();
  });
}
