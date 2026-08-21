import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';

/** Erros de domínio de Contratos. Cada um declara o TIPO de problema. */

export class ContractNotFoundError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(contractId: string) {
    super(`Contrato ${contractId} não encontrado nesta empresa.`);
  }
}

export class ProposalNotInThisTenantError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(proposalId: string) {
    super(`Proposta ${proposalId} não encontrada nesta empresa.`);
  }
}

export class ProposalNotAcceptedError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(situacao: string) {
    super(
      `Só uma proposta aceita vira contrato; esta está "${situacao}". ` +
        'Registre o aceite do cliente antes de formalizar.',
    );
  }
}

export class ProposalAlreadyContractedError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(number: number) {
    super(
      `Esta proposta já gerou o contrato nº ${number}. Uma proposta vira um contrato só.`,
    );
  }
}

export class InvalidContractTermError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(detalhe: string) {
    super(`Vigência inválida: ${detalhe}.`);
  }
}

export class ContractNotDraftError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(status: string) {
    super(
      `Só um contrato em rascunho pode ser ativado; este está ${traduzir(status)}.`,
    );
  }
}

export class ContractNotActiveError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(status: string) {
    super(
      `Só um contrato ativo pode ser encerrado; este está ${traduzir(status)}.`,
    );
  }
}

export class ContractTermEndedError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(endsOn: Date) {
    super(
      `A vigência terminou em ${endsOn.toISOString()}; um contrato não nasce vencido. Corrija as datas.`,
    );
  }
}

function traduzir(status: string): string {
  const nomes: Record<string, string> = {
    draft: 'em rascunho',
    active: 'ativo',
    finished: 'encerrado',
    canceled: 'cancelado',
  };
  return nomes[status] ?? status;
}
