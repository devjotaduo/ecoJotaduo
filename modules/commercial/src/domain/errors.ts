import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';

/**
 * Erros de domínio do Comercial. Cada um declara o TIPO de problema; a borda
 * traduz para status HTTP (ou para o formato de erro do MCP).
 */

export class InvalidMoneyError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(detalhe: string) {
    super(`Valor monetário inválido: ${detalhe}.`);
  }
}

export class MixedCurrencyError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(esperada: string, recebida: string) {
    super(
      `A proposta está em ${esperada} e o item veio em ${recebida}. Uma proposta tem uma moeda só.`,
    );
  }
}

export class ProposalNotFoundError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(proposalId: string) {
    super(`Proposta ${proposalId} não encontrada nesta empresa.`);
  }
}

export class CustomerNotInThisTenantError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(customerId: string) {
    super(`Cliente ${customerId} não encontrado nesta empresa.`);
  }
}

export class EmptyProposalError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor() {
    super('Uma proposta precisa de ao menos um item para ser enviada.');
  }
}

export class InvalidProposalItemError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(detalhe: string) {
    super(`Item inválido: ${detalhe}.`);
  }
}

export class DiscountExceedsSubtotalError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor() {
    super('O desconto não pode ser maior que o subtotal do item.');
  }
}

export class ProposalNotEditableError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(status: string) {
    super(
      `Uma proposta ${traduzir(status)} não pode mais ser alterada. Crie uma nova versão.`,
    );
  }
}

export class ProposalNotDecidableError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(status: string) {
    super(
      `Só uma proposta enviada pode ser aceita ou recusada; esta está ${traduzir(status)}.`,
    );
  }
}

export class ProposalExpiredError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(validUntil: Date) {
    super(
      `A proposta venceu em ${validUntil.toISOString()}. Reenvie com nova validade antes de decidir.`,
    );
  }
}

export class InvalidValidityError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor() {
    super('A validade da proposta precisa estar no futuro.');
  }
}

function traduzir(status: string): string {
  const nomes: Record<string, string> = {
    draft: 'em rascunho',
    sent: 'enviada',
    accepted: 'aceita',
    rejected: 'recusada',
  };
  return nomes[status] ?? status;
}
