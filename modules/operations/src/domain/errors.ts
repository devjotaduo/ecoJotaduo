import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';

/** Erros de domínio de Operações. Cada um declara o TIPO de problema. */

export class RentalNotFoundError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(rentalId: string) {
    super(`Locação ${rentalId} não encontrada nesta empresa.`);
  }
}

export class ContractNotInThisTenantError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(contractId: string) {
    super(`Contrato ${contractId} não encontrado nesta empresa.`);
  }
}

export class AssetNotInThisTenantError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(assetId: string) {
    super(`Equipamento ${assetId} não encontrado nesta empresa.`);
  }
}

export class ContractNotActiveError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(situacao: string) {
    super(
      `Só um contrato em vigor gera locação; este está "${situacao}". ` +
        'Ative o contrato antes de programar a saída do equipamento.',
    );
  }
}

export class RentalOutsideContractTermError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(inicio: Date, fim: Date) {
    super(
      `A locação precisa caber na vigência do contrato (${inicio.toISOString()} a ${fim.toISOString()}). ` +
        'Equipamento na rua fora da vigência não tem o que o cubra.',
    );
  }
}

export class InvalidRentalPeriodError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(detalhe: string) {
    super(`Período inválido: ${detalhe}.`);
  }
}

export class RentalNotScheduledError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(status: string) {
    super(
      `Só uma locação programada pode ser iniciada; esta está ${traduzir(status)}.`,
    );
  }
}

export class RentalNotActiveError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(status: string) {
    super(
      `Só uma locação em andamento pode ser devolvida; esta está ${traduzir(status)}.`,
    );
  }
}

export class RentalAlreadyStartedError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor() {
    super(
      'O equipamento já saiu: cancelar não traz de volta. Registre a devolução.',
    );
  }
}

function traduzir(status: string): string {
  const nomes: Record<string, string> = {
    scheduled: 'programada',
    active: 'em andamento',
    finished: 'encerrada',
    canceled: 'cancelada',
  };
  return nomes[status] ?? status;
}
