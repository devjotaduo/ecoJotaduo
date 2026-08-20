/** Problem Details (RFC 9457) — a forma de todo erro da API. */
export interface ProblemaDetalhado {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string;
  readonly correlationId?: string;
  readonly errors?: string[];
}

const BASE = 'https://jotaduo.com/ecojotaduo/errors/';

/**
 * Erro da API já interpretado.
 *
 * Existe para o consumidor não precisar reinterpretar corpo e status em cada
 * chamada — e para o `correlationId` chegar junto, que é por onde se investiga
 * o que aconteceu no servidor.
 */
export class ApiError extends Error {
  constructor(readonly problema: ProblemaDetalhado) {
    super(problema.detail || problema.title);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problema.status;
  }

  get correlationId(): string | undefined {
    return this.problema.correlationId;
  }

  /** Violações de validação, quando houver (HTTP 400). */
  get violacoes(): string[] {
    return this.problema.errors ?? [];
  }

  private ehDoTipo(slug: string): boolean {
    return this.problema.type === `${BASE}${slug}`;
  }

  /** Sessão ausente, inválida ou expirada. */
  get naoAutenticado(): boolean {
    return this.status === 401;
  }

  /** A empresa não contratou o módulo da rota — acionável pelo administrador. */
  get moduloNaoContratado(): boolean {
    return this.ehDoTipo('module-not-entitled');
  }

  get semPermissao(): boolean {
    return this.ehDoTipo('forbidden');
  }

  get empresaInativa(): boolean {
    return this.ehDoTipo('tenant-inactive');
  }
}

/** Converte a resposta HTTP em ApiError, tolerando corpo não-JSON. */
export async function erroDaResposta(resposta: Response): Promise<ApiError> {
  let problema: ProblemaDetalhado = {
    type: `${BASE}internal`,
    title: 'Erro inesperado',
    status: resposta.status,
    detail: `A API respondeu ${resposta.status}.`,
  };

  try {
    const corpo: unknown = await resposta.json();
    if (typeof corpo === 'object' && corpo !== null && 'status' in corpo) {
      problema = corpo as ProblemaDetalhado;
    }
  } catch {
    // Corpo vazio ou não-JSON (proxy fora do ar, timeout de gateway): o
    // problema genérico acima já descreve o que dá para afirmar.
  }

  return new ApiError(problema);
}
