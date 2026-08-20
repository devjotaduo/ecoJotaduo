import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';

/**
 * Erros de domínio do CRM.
 *
 * Cada um declara o TIPO de problema que representa; a borda traduz para
 * status HTTP (ou para o formato de erro do MCP). Ver
 * packages/platform-kernel/src/errors.ts.
 */

export class InvalidDocumentError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(valor: string) {
    super(`Documento inválido: "${valor}". Informe um CPF ou CNPJ válido.`);
  }
}

export class InvalidCustomerNameError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor() {
    super('O nome do cliente precisa ter entre 2 e 200 caracteres.');
  }
}

export class DuplicateCustomerDocumentError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(documento: string) {
    super(`Já existe um cliente com o documento ${documento} nesta empresa.`);
  }
}

export class CustomerNotFoundError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(customerId: string) {
    super(`Cliente não encontrado: ${customerId}.`);
  }
}

export class CustomerArchivedError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor() {
    super('Cliente arquivado não aceita novas notas nem agendamentos.');
  }
}

export class EmptyNoteError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor() {
    super('A nota precisa ter conteúdo (até 5000 caracteres).');
  }
}

export class AppointmentNotFoundError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(appointmentId: string) {
    super(`Agendamento não encontrado: ${appointmentId}.`);
  }
}

export class AppointmentInThePastError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor() {
    super('Não é possível agendar para um horário que já passou.');
  }
}

export class InvalidAppointmentDurationError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor() {
    super('A duração do agendamento precisa ficar entre 5 e 480 minutos.');
  }
}

export class InvalidAppointmentTitleError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor() {
    super('O título do agendamento precisa ter até 200 caracteres.');
  }
}

export class AppointmentConflictError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(
    readonly conflitanteId: string,
    readonly inicio: Date,
  ) {
    super(
      'O responsável já tem um agendamento que se sobrepõe a este horário ' +
        `(${inicio.toISOString()}).`,
    );
  }
}

export class AppointmentNotOpenError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(status: string) {
    super(`Agendamento com status "${status}" não pode mais ser alterado.`);
  }
}
