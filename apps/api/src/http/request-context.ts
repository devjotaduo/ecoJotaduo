import { randomUUID } from 'node:crypto';

import { createContext, runWithContext } from '@movimentar/tenant-context';
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
    runWithContext(createContext('rest', correlationId), done);
  });
}
