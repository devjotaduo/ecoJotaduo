/** Erros de domínio do módulo de identidade. */

export class InvalidEmailError extends Error {
  constructor(valor: string) {
    super(`E-mail inválido: "${valor}".`);
    this.name = 'InvalidEmailError';
  }
}

/**
 * Usada tanto para e-mail inexistente quanto para senha errada — a mensagem é
 * deliberadamente idêntica nos dois casos, para não revelar quais e-mails
 * existem na plataforma (enumeração de usuários).
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Credenciais inválidas.');
    this.name = 'InvalidCredentialsError';
  }
}

export class UserNotActiveError extends Error {
  constructor() {
    super('Usuário inativo ou suspenso.');
    this.name = 'UserNotActiveError';
  }
}
