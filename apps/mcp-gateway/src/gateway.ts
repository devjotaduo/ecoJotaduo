import { randomUUID } from 'node:crypto';

import type { Env } from '@ecojotaduo/config';
import {
  criarNucleo,
  type NucleoDaPlataforma,
} from '@ecojotaduo/platform-core';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import { InvalidTokenError } from '@ecojotaduo/auth';
import {
  NoActiveMembershipError,
  TenantNotActiveError,
  TenantNotFoundError,
} from '@ecojotaduo/tenancy';

import { autorizar, NaoAutenticadoError } from './authorize';
import { criarServidorMcp } from './server';

export const ROTA_MCP = '/mcp';
const CORRELATION_HEADER = 'x-correlation-id';

export interface Gateway {
  readonly app: FastifyInstance;
  readonly nucleo: NucleoDaPlataforma;
}

/**
 * Composition root do gateway MCP.
 *
 * Monta o MESMO núcleo da API REST (`criarNucleo`) e liga só a borda: nenhuma
 * regra de negócio mora aqui. Um agente e uma tela chamam o mesmo caso de uso
 * — o que muda é o transporte.
 *
 * Fastify puro, sem NestJS: o gateway tem uma rota só, e o ciclo de vida de
 * DI de um framework de aplicação não pagaria por si.
 */
export function criarGateway(env: Env): Gateway {
  const nucleo = criarNucleo(env);
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  app.get('/health', () => ({ status: 'ok', service: 'mcp-gateway' }));

  /**
   * Transporte Streamable HTTP em modo **stateless** (`sessionIdGenerator:
   * undefined`): nada é guardado entre chamadas.
   *
   * Não é economia — é requisito de segurança. Estado de conexão viraria um
   * segundo lugar onde tenant e permissões existem, e é exatamente aí que
   * mora a falha clássica: sessão iniciada com um acesso e reaproveitada
   * depois que ele foi revogado. Sem sessão, toda chamada reautoriza contra o
   * banco. De quebra, qualquer réplica atende qualquer requisição.
   */
  const responder = async (
    requisicao: FastifyRequest,
    resposta: FastifyReply,
  ): Promise<void> => {
    const informado = requisicao.headers[CORRELATION_HEADER];
    const correlationId =
      typeof informado === 'string' && informado.length <= 64
        ? informado
        : randomUUID();
    void resposta.header(CORRELATION_HEADER, correlationId);

    let sessao;
    try {
      sessao = await autorizar(
        { tokens: nucleo.tokens, tenancy: nucleo.tenancy },
        requisicao.headers.authorization,
        correlationId,
      );
    } catch (erro) {
      recusar(resposta, erro);
      return;
    }

    const server = criarServidorMcp(nucleo.mcp, sessao);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Servidor e transporte vivem uma requisição. Sem este fechamento eles
    // vazariam a cada chamada de agente.
    resposta.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    // A partir daqui quem escreve na resposta é o transporte.
    resposta.hijack();
    await transport.handleRequest(
      requisicao.raw,
      resposta.raw,
      requisicao.body,
    );
  };

  app.post(ROTA_MCP, responder);
  // GET (stream do servidor) e DELETE (encerrar sessão) passam pelo mesmo
  // caminho: em modo stateless o próprio transporte responde 405, e a
  // autorização acontece antes de qualquer coisa.
  app.get(ROTA_MCP, responder);
  app.delete(ROTA_MCP, responder);

  return { app, nucleo };
}

/**
 * Recusa de acesso no formato de erro JSON-RPC que um cliente MCP entende.
 *
 * Igual à API REST: token expirado, empresa inexistente e vínculo revogado
 * devolvem exatamente a mesma coisa. Distinguir contaria ao atacante qual das
 * três ele acertou. Empresa suspensa é o único caso separado (403), porque aí
 * a credencial está certa e quem resolve é o administrador.
 *
 * Qualquer outra exceção sobe: falha de banco não pode virar 401 silencioso.
 */
function recusar(resposta: FastifyReply, erro: unknown): void {
  if (erro instanceof TenantNotActiveError) {
    void enviarErro(
      resposta,
      403,
      'Esta empresa está suspensa. Fale com o administrador da plataforma.',
    );
    return;
  }

  const naoAutenticado =
    erro instanceof NaoAutenticadoError ||
    erro instanceof InvalidTokenError ||
    erro instanceof TenantNotFoundError ||
    erro instanceof NoActiveMembershipError;

  if (!naoAutenticado) {
    throw erro;
  }

  void resposta.header('www-authenticate', 'Bearer realm="ecojotaduo"');
  void enviarErro(resposta, 401, 'Credenciais inválidas ou sessão expirada.');
}

function enviarErro(
  resposta: FastifyReply,
  status: number,
  mensagem: string,
): FastifyReply {
  return resposta
    .status(status)
    .header('content-type', 'application/json; charset=utf-8')
    .send({
      jsonrpc: '2.0',
      error: { code: ErrorCode.InvalidRequest, message: mensagem },
      id: null,
    });
}
