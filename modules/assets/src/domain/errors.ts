import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';

/** Erros de domínio de Ativos. Cada um declara o TIPO de problema. */

export class AssetNotFoundError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(assetId: string) {
    super(`Ativo ${assetId} não encontrado nesta empresa.`);
  }
}

export class HoldNotFoundError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(holdId: string) {
    super(`Bloqueio ${holdId} não encontrado nesta empresa.`);
  }
}

export class DuplicateAssetCodeError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(code: string) {
    super(
      `Já existe um ativo com o código "${code}" nesta empresa. ` +
        'O código é a identificação de patrimônio: dois ativos com o mesmo ' +
        'código tornam impossível dizer qual saiu para o cliente.',
    );
  }
}

export class InvalidAssetPeriodError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(detalhe: string) {
    super(`Período inválido: ${detalhe}.`);
  }
}

export class AssetRetiredError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(code: string) {
    super(
      `O ativo ${code} foi baixado e não volta a operar. Cadastre um ativo novo.`,
    );
  }
}

export class AssetHeldError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(code: string, ate: Date) {
    super(
      `O ativo ${code} já está bloqueado nesse intervalo (até ${ate.toISOString()}). ` +
        'Libere o bloqueio existente ou escolha outro período.',
    );
  }
}

export class AssetInUseError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(code: string) {
    super(
      `O ativo ${code} tem bloqueio em vigor agora e não pode ser baixado. ` +
        'Libere o bloqueio antes — dar baixa em equipamento que está com ' +
        'alguém apaga o rastro de onde ele está.',
    );
  }
}

export class HoldAlreadyReleasedError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(holdId: string) {
    super(`O bloqueio ${holdId} já foi liberado.`);
  }
}
