import { randomUUID } from 'node:crypto';

import type { Env } from '@ecojotaduo/config';
import {
  criarNucleo,
  type NucleoDaPlataforma,
} from '@ecojotaduo/platform-core';
import {
  CABECALHOS_DE_SEGURANCA,
  linhaDeRequisicao,
} from '@ecojotaduo/platform-kernel';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import { InvalidTokenError } from '@ecojotaduo/auth';
import { PersonalTokenInvalidError } from '@ecojotaduo/identity';
import {
  NoActiveMembershipError,
  TenantNotActiveError,
  TenantNotFoundError,
} from '@ecojotaduo/tenancy';

import { autorizar, NaoAutenticadoError } from './authorize';
import { opcoesDeRateLimit } from './rate-limit';
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
 *
 * Assíncrona por causa do plugin de rate limit: ele precisa estar carregado
 * ANTES das rotas, senão o hook não vale para elas.
 */
/** Status que o próprio erro declara, quando declara (plugins do Fastify). */
function statusDeclarado(erro: unknown): number | undefined {
  if (erro instanceof Error && 'statusCode' in erro) {
    const status = (erro as { statusCode?: unknown }).statusCode;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

export async function criarGateway(env: Env): Promise<Gateway> {
  const nucleo = criarNucleo(env);
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  // `await` e não `void`: o registro de plugin é adiado até o boot, e um hook
  // que chega depois das rotas simplesmente não vale para elas. Sem esperar
  // aqui, o limitador ficava carregado e inerte — pior que não existir, porque
  // parece protegido.
  await app.register(rateLimit, opcoesDeRateLimit(env));

  // Os MESMOS cabeçalhos da API REST. A borda MCP responde JSON como a outra,
  // e ser a borda frouxa é como um afrouxamento acaba chegando à produção.
  app.addHook('onRequest', (_requisicao, resposta, feito) => {
    for (const [nome, valor] of Object.entries(CABECALHOS_DE_SEGURANCA)) {
      void resposta.header(nome, valor);
    }
    feito();
  });

  /**
   * Uma linha por chamada, com quem, de qual empresa, quanto tempo e com que
   * resultado — o critério de aceite da Fase 10 vale para as duas bordas.
   *
   * O contexto da sessão é montado dentro do handler, então aqui ele já não
   * está ativo: o que se registra é o que a própria requisição carrega.
   */
  app.addHook('onResponse', (requisicao, resposta, feito) => {
    app.log.info(
      linhaDeRequisicao({
        method: requisicao.method,
        route: requisicao.routeOptions?.url ?? requisicao.url,
        status: resposta.statusCode,
        durationMs: Math.round(resposta.elapsedTime),
        correlationId: String(resposta.getHeader(CORRELATION_HEADER) ?? ''),
        channel: 'mcp',
      }),
    );
    feito();
  });

  app.get('/health', () => ({ status: 'ok', service: 'mcp-gateway' }));

  /**
   * 500 genérico. O handler padrão do Fastify devolve `error.message` ao
   * cliente, e mensagem de erro de banco carrega nome de tabela e trecho de
   * consulta — a API REST já não faz isso (`ProblemDetailsFilter`), e a borda
   * MCP não pode ser a frouxa. O motivo real fica no log.
   */
  app.setErrorHandler((erro, _requisicao, resposta) => {
    // Recusa por excesso: o plugin de rate limit declara o próprio status, e
    // devolvê-la como 500 diria "o servidor quebrou" quando o servidor está
    // justamente se protegendo — o cliente precisa saber que é para esperar.
    if (statusDeclarado(erro) === 429) {
      void enviarErro(
        resposta,
        429,
        'Limite de chamadas excedido para esta credencial. Tente novamente em instantes.',
      );
      return;
    }
    app.log.error(erro);
    void enviarErro(resposta, 500, 'Erro inesperado ao processar a chamada.');
  });

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
        {
          tokens: nucleo.tokens,
          tenancy: nucleo.tenancy,
          identity: nucleo.identity,
        },
        requisicao.headers.authorization,
        correlationId,
      );
    } catch (erro) {
      recusar(resposta, erro);
      return;
    }

    const server = criarServidorMcp(nucleo.mcp, sessao, nucleo.audit);
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
    try {
      await transport.handleRequest(
        requisicao.raw,
        resposta.raw,
        requisicao.body,
      );
    } catch (erro) {
      // Depois do hijack o Fastify não responde mais por esta requisição: uma
      // exceção aqui deixaria o host esperando para sempre. Fechar é pior que
      // uma resposta boa e melhor que um socket pendurado.
      app.log.error(erro);
      resposta.raw.destroy();
    }
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
    erro instanceof PersonalTokenInvalidError ||
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
