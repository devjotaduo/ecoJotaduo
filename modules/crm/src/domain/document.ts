import { InvalidDocumentError } from './errors';

export type DocumentKind = 'cpf' | 'cnpj';

/** Calcula um dígito verificador pela soma ponderada padrão de CPF/CNPJ. */
function digitoVerificador(
  digitos: readonly number[],
  pesos: readonly number[],
): number {
  const soma = digitos.reduce(
    (total, digito, indice) => total + digito * (pesos[indice] ?? 0),
    0,
  );
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cpfEhValido(digitos: readonly number[]): boolean {
  const primeiro = digitoVerificador(
    digitos.slice(0, 9),
    [10, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  const segundo = digitoVerificador(
    digitos.slice(0, 10),
    [11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return digitos[9] === primeiro && digitos[10] === segundo;
}

function cnpjEhValido(digitos: readonly number[]): boolean {
  const primeiro = digitoVerificador(
    digitos.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  const segundo = digitoVerificador(
    digitos.slice(0, 13),
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return digitos[12] === primeiro && digitos[13] === segundo;
}

/**
 * Documento do cliente (CPF ou CNPJ).
 *
 * Guarda apenas os dígitos: é assim que a unicidade por empresa funciona sem
 * depender de como a pessoa digitou (com ou sem pontuação). Os dígitos
 * verificadores são conferidos aqui, no domínio — não é validação de formulário,
 * é invariante do cadastro.
 */
export class CustomerDocument {
  private constructor(
    readonly digits: string,
    readonly kind: DocumentKind,
  ) {}

  static create(valor: string): CustomerDocument {
    const digitos = valor.replace(/\D/g, '');

    if (digitos.length !== 11 && digitos.length !== 14) {
      throw new InvalidDocumentError(valor);
    }
    // Sequências repetidas (000..., 111...) passam no cálculo, mas não existem.
    if (/^(\d)\1+$/.test(digitos)) {
      throw new InvalidDocumentError(valor);
    }

    const numeros = [...digitos].map(Number);
    const kind: DocumentKind = digitos.length === 11 ? 'cpf' : 'cnpj';
    const valido =
      kind === 'cpf' ? cpfEhValido(numeros) : cnpjEhValido(numeros);
    if (!valido) {
      throw new InvalidDocumentError(valor);
    }

    return new CustomerDocument(digitos, kind);
  }

  /** Formatação para exibição; o armazenamento continua só com dígitos. */
  format(): string {
    return this.kind === 'cpf'
      ? this.digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      : this.digits.replace(
          /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
          '$1.$2.$3/$4-$5',
        );
  }

  toString(): string {
    return this.digits;
  }
}
