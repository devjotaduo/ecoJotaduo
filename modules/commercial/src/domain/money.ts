import { InvalidMoneyError, MixedCurrencyError } from './errors';

/**
 * Dinheiro como **inteiro em centavos + moeda** (convenção da plataforma).
 *
 * Float é o erro clássico de ERP: `0.1 + 0.2` não dá `0.3`, e a diferença
 * aparece no fechamento do mês, não no teste. Guardando centavos, soma e
 * multiplicação por quantidade são exatas.
 *
 * A moeda anda junto do valor porque somar valores de moedas diferentes é um
 * erro que precisa estourar, não virar um número sem sentido.
 */
export class Money {
  private constructor(
    readonly cents: number,
    readonly currency: string,
  ) {}

  static of(cents: number, currency: string): Money {
    if (!Number.isSafeInteger(cents)) {
      throw new InvalidMoneyError(
        `valor precisa ser inteiro em centavos, veio "${cents}"`,
      );
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new InvalidMoneyError(
        `moeda precisa ser um código ISO 4217, veio "${currency}"`,
      );
    }
    return new Money(cents, currency);
  }

  static zero(currency: string): Money {
    return Money.of(0, currency);
  }

  plus(outro: Money): Money {
    this.exigirMesmaMoeda(outro);
    return Money.of(this.cents + outro.cents, this.currency);
  }

  minus(outro: Money): Money {
    this.exigirMesmaMoeda(outro);
    return Money.of(this.cents - outro.cents, this.currency);
  }

  /** Multiplica por uma quantidade inteira (itens não são fracionados aqui). */
  times(quantidade: number): Money {
    if (!Number.isSafeInteger(quantidade) || quantidade < 0) {
      throw new InvalidMoneyError(
        `quantidade precisa ser inteiro não negativo, veio "${quantidade}"`,
      );
    }
    return Money.of(this.cents * quantidade, this.currency);
  }

  get isNegative(): boolean {
    return this.cents < 0;
  }

  isGreaterThan(outro: Money): boolean {
    this.exigirMesmaMoeda(outro);
    return this.cents > outro.cents;
  }

  private exigirMesmaMoeda(outro: Money): void {
    if (this.currency !== outro.currency) {
      throw new MixedCurrencyError(this.currency, outro.currency);
    }
  }
}
