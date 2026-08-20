import { InvalidEmailError } from './errors';

const FORMATO = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const TAMANHO_MAXIMO = 254;

/**
 * Value object de e-mail. Normaliza para minúsculas na criação: é isso que
 * garante que "Maria@Empresa.com" e "maria@empresa.com" sejam o mesmo login
 * (e que o índice único do banco funcione como esperado).
 */
export class Email {
  private constructor(readonly value: string) {}

  static create(valor: string): Email {
    const normalizado = valor.trim().toLowerCase();
    if (normalizado.length > TAMANHO_MAXIMO || !FORMATO.test(normalizado)) {
      throw new InvalidEmailError(valor);
    }
    return new Email(normalizado);
  }

  toString(): string {
    return this.value;
  }

  equals(outro: Email): boolean {
    return this.value === outro.value;
  }
}
