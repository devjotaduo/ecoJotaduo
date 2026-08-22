import { InvalidTokenError } from '@ecojotaduo/auth';
import { PersonalTokenInvalidError } from '@ecojotaduo/identity';
import {
  AcessoNegadoError,
  PromptDesconhecidoError,
  RecursoDesconhecidoError,
  ToolDesconhecidaError,
} from '@ecojotaduo/mcp-kit';
import { DomainError } from '@ecojotaduo/platform-kernel';
import {
  ErrorCode,
  McpError,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { NaoAutenticadoError } from './authorize';

/**
 * Duas naturezas de falha, duas respostas diferentes — e a distinção importa.
 *
 * **Erro de protocolo** (JSON-RPC error): a chamada não aconteceu. Tool
 * inexistente, entrada inválida, permissão negada. O host precisa saber que
 * não houve execução, em vez de receber um texto que o modelo interpretaria
 * como resultado.
 *
 * **Erro de tool** (`isError: true`): a chamada aconteceu e o domínio disse
 * não — documento já cadastrado, horário ocupado. É informação útil para o
 * agente, que consegue corrigir e tentar de novo.
 */

/** Traduz qualquer exceção para o erro de protocolo correspondente. */
export function erroDeProtocolo(erro: unknown): McpError {
  if (erro instanceof McpError) {
    return erro;
  }

  if (erro instanceof ToolDesconhecidaError) {
    return new McpError(ErrorCode.MethodNotFound, erro.message);
  }

  if (
    erro instanceof RecursoDesconhecidoError ||
    erro instanceof PromptDesconhecidoError
  ) {
    return new McpError(ErrorCode.InvalidParams, erro.message);
  }

  if (erro instanceof z.ZodError) {
    return new McpError(ErrorCode.InvalidParams, 'Entrada inválida.', {
      errors: erro.issues.map(
        (issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
      ),
    });
  }

  if (erro instanceof AcessoNegadoError) {
    // A mensagem já distingue "módulo não contratado" de "sem permissão" —
    // as duas são acionáveis por quem administra a empresa.
    return new McpError(ErrorCode.InvalidRequest, erro.message);
  }

  if (
    erro instanceof NaoAutenticadoError ||
    erro instanceof InvalidTokenError ||
    erro instanceof PersonalTokenInvalidError
  ) {
    return new McpError(
      ErrorCode.InvalidRequest,
      'Credenciais inválidas ou sessão expirada.',
    );
  }

  // Erro de domínio que escapou para um caminho sem `isError` (resource ou
  // prompt): ainda é recusa de negócio, não falha interna.
  if (erro instanceof DomainError) {
    return new McpError(ErrorCode.InvalidParams, erro.message);
  }

  return new McpError(
    ErrorCode.InternalError,
    'Erro inesperado ao processar a chamada.',
  );
}

/** Envolve um handler MCP traduzindo o que escapar. */
export function protocolo<Req, Res>(
  handler: (requisicao: Req) => Res | Promise<Res>,
): (requisicao: Req) => Promise<Res> {
  return async (requisicao) => {
    try {
      return await handler(requisicao);
    } catch (erro) {
      throw erroDeProtocolo(erro);
    }
  };
}

/**
 * Recusa do domínio vira resultado de tool. Qualquer outra coisa volta a ser
 * erro de protocolo — inclusive falha interna, que não pode virar texto para
 * o modelo raciocinar em cima.
 */
export function comoErroDeTool(erro: unknown): CallToolResult {
  if (!(erro instanceof DomainError)) {
    throw erroDeProtocolo(erro);
  }
  return {
    content: [{ type: 'text', text: erro.message }],
    isError: true,
  };
}
