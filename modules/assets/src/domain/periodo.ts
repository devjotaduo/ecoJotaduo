import { InvalidAssetPeriodError } from './errors';

/**
 * Intervalo fechado no início e aberto no fim: `[inicio, fim)`.
 *
 * A borda aberta não é detalhe: um bloqueio que termina às 12h e outro que
 * começa às 12h **não** se sobrepõem. Com os dois lados fechados, todo
 * encadeamento normal de operações viraria conflito.
 */
export class Periodo {
  private constructor(
    readonly inicio: Date,
    readonly fim: Date,
  ) {}

  static de(inicio: Date, fim: Date): Periodo {
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new InvalidAssetPeriodError('data inválida');
    }
    if (fim.getTime() <= inicio.getTime()) {
      throw new InvalidAssetPeriodError('o fim precisa ser depois do início');
    }
    return new Periodo(inicio, fim);
  }

  sobrepoe(outro: Periodo): boolean {
    return (
      this.inicio.getTime() < outro.fim.getTime() &&
      outro.inicio.getTime() < this.fim.getTime()
    );
  }

  contem(instante: Date): boolean {
    return (
      this.inicio.getTime() <= instante.getTime() &&
      instante.getTime() < this.fim.getTime()
    );
  }

  /** Antecipa o fim; usado quando o ativo é liberado antes do previsto. */
  encerradoEm(instante: Date): Periodo {
    // Liberar antes de começar zera o período em vez de invertê-lo — um
    // intervalo de duração zero não sobrepõe nada, que é o efeito desejado.
    const fim = Math.max(this.inicio.getTime(), instante.getTime());
    return new Periodo(
      this.inicio,
      new Date(Math.min(fim, this.fim.getTime())),
    );
  }

  get vazio(): boolean {
    return this.fim.getTime() <= this.inicio.getTime();
  }
}
