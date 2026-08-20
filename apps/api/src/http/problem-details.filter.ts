import { InvalidTokenError } from '@ecojotaduo/auth';
import {
  InvalidCredentialsError,
  UserNotActiveError,
  RefreshTokenInvalidError,
} from '@ecojotaduo/identity';
import { ForbiddenError } from '@ecojotaduo/permissions';
import {
  DomainError,
  STATUS_POR_PROBLEMA,
  type ProblemKind,
} from '@ecojotaduo/platform-kernel';
import {
  ModuleAlreadyEntitledError,
  NoActiveMembershipError,
  TenantNotActiveError,
  TenantNotFoundError,
  UnknownModuleError,
} from '@ecojotaduo/tenancy';
import { getContext } from '@ecojotaduo/tenant-context';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

const BASE = 'https://jotaduo.com/ecojotaduo/errors';

const TITULO_POR_PROBLEMA: Record<ProblemKind, string> = {
  'invalid-request': 'Requisição inválida',
  forbidden: 'Acesso negado',
  'not-found': 'Não encontrado',
  conflict: 'Conflito',
};

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  correlationId?: string;
  errors?: unknown;
}

/**
 * Respostas de erro no formato Problem Details (RFC 9457).
 *
 * Erros de autenticação são deliberadamente uniformes: o cliente recebe
 * sempre "Credenciais inválidas", sem distinguir usuário inexistente, senha
 * errada ou empresa desconhecida. O motivo real fica no log do servidor.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(excecao: unknown, host: ArgumentsHost): void {
    const contextoHttp = host.switchToHttp();
    const resposta = contextoHttp.getResponse<FastifyReply>();
    const requisicao = contextoHttp.getRequest<FastifyRequest>();

    const problema = this.mapear(excecao, requisicao.url);
    const contexto = getContext();
    if (contexto) {
      problema.correlationId = contexto.correlationId;
    }

    if (problema.status >= 500) {
      this.logger.error(
        `${problema.status} ${requisicao.method} ${requisicao.url}`,
        excecao instanceof Error ? excecao.stack : String(excecao),
      );
    } else {
      this.logger.warn(
        `${problema.status} ${requisicao.method} ${requisicao.url} — ${
          excecao instanceof Error ? excecao.message : 'erro'
        }`,
      );
    }

    void resposta
      .status(problema.status)
      .header('content-type', 'application/problem+json; charset=utf-8')
      .send(problema);
  }

  private mapear(excecao: unknown, instancia: string): ProblemDetails {
    const problema = (
      tipo: string,
      titulo: string,
      status: number,
      detalhe: string,
    ): ProblemDetails => ({
      type: `${BASE}/${tipo}`,
      title: titulo,
      status,
      detail: detalhe,
      instance: instancia,
    });

    // 401 — sempre com a mesma mensagem, para não revelar o que existe.
    if (
      excecao instanceof InvalidCredentialsError ||
      excecao instanceof UserNotActiveError ||
      excecao instanceof NoActiveMembershipError ||
      excecao instanceof TenantNotFoundError ||
      excecao instanceof InvalidTokenError ||
      excecao instanceof RefreshTokenInvalidError
    ) {
      return problema(
        'unauthorized',
        'Não autenticado',
        401,
        'Credenciais inválidas ou sessão expirada.',
      );
    }

    if (excecao instanceof TenantNotActiveError) {
      return problema(
        'tenant-inactive',
        'Empresa inativa',
        403,
        'Esta empresa está suspensa. Fale com o administrador da plataforma.',
      );
    }

    if (excecao instanceof ForbiddenError) {
      return excecao.reason === 'entitlement'
        ? problema(
            'module-not-entitled',
            'Módulo não contratado',
            403,
            excecao.message,
          )
        : problema(
            'forbidden',
            'Acesso negado',
            403,
            'Você não tem permissão para esta operação.',
          );
    }

    // Erros de domínio dos módulos declaram o tipo de problema; a borda só
    // traduz. Assim um módulo novo não exige editar este arquivo.
    if (excecao instanceof DomainError) {
      return problema(
        excecao.kind,
        TITULO_POR_PROBLEMA[excecao.kind],
        STATUS_POR_PROBLEMA[excecao.kind],
        excecao.message,
      );
    }

    if (excecao instanceof ModuleAlreadyEntitledError) {
      return problema('conflict', 'Conflito', 409, excecao.message);
    }

    if (excecao instanceof UnknownModuleError) {
      return problema(
        'invalid-request',
        'Requisição inválida',
        400,
        excecao.message,
      );
    }

    if (excecao instanceof HttpException) {
      const status = excecao.getStatus();
      const corpo = excecao.getResponse();
      const bruto: unknown =
        typeof corpo === 'string'
          ? corpo
          : ((corpo as { message?: unknown }).message ?? excecao.message);

      // Lista de violações (vinda do ZodValidationPipe) vira campo `errors`;
      // o `detail` fica genérico para não vazar detalhes de implementação.
      const violacoes = Array.isArray(bruto) ? bruto : undefined;
      const resultado = problema(
        status === 401 ? 'unauthorized' : 'http-error',
        excecao.name,
        status,
        violacoes
          ? 'Requisição inválida.'
          : typeof bruto === 'string'
            ? bruto
            : excecao.message,
      );
      if (violacoes) {
        resultado.errors = violacoes;
      }
      return resultado;
    }

    return problema(
      'internal',
      'Erro interno',
      500,
      'Erro inesperado ao processar a requisição.',
    );
  }
}
