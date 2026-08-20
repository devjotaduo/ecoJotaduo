/**
 * Erro de domínio com intenção de resposta declarada.
 *
 * Sem isto, cada módulo novo obrigaria a editar o filtro de erros da API —
 * uma lista de `instanceof` que cresce sem fim e que alguém esquece de
 * atualizar (aí o erro de negócio vira 500). Aqui o próprio domínio diz que
 * TIPO de problema ele é; a borda decide como isso vira status HTTP, código
 * MCP ou retry de job.
 *
 * O domínio continua sem conhecer HTTP: `kind` é vocabulário de negócio
 * ("conflito", "não encontrado"), não de protocolo.
 */
export type ProblemKind =
  'invalid-request' | 'not-found' | 'conflict' | 'forbidden';

export abstract class DomainError extends Error {
  abstract readonly kind: ProblemKind;

  constructor(mensagem: string) {
    super(mensagem);
    this.name = new.target.name;
  }
}

/** Mapeamento canônico para HTTP, usado pelos adaptadores REST. */
export const STATUS_POR_PROBLEMA: Record<ProblemKind, number> = {
  'invalid-request': 400,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
};
