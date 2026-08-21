import { AssetRetiredError } from './errors';
import type { AssetHold } from './hold';

/**
 * Ativo: o equipamento que a empresa possui e coloca para trabalhar.
 *
 * Só dois estados são GUARDADOS: `active` e `retired`. "Disponível" e
 * "bloqueado" não são estados do ativo — são leitura dos bloqueios sobre ele
 * num instante. Guardar isso numa coluna criaria duas verdades sobre a mesma
 * coisa, e a coluna só estaria certa até o próximo bloqueio começar sem que
 * alguém rodasse a rotina que a atualiza.
 */
export type AssetStatus = 'active' | 'retired';

/** O que a leitura enxerga: o estado guardado mais os bloqueios do momento. */
export type AssetAvailability = 'available' | 'held' | 'retired';

export interface DadosDoAtivo {
  readonly id: string;
  readonly tenantId: string;
  /** Identificação de patrimônio, única na empresa. */
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly serialNumber: string | null;
  readonly acquiredOn: Date | null;
  readonly status: AssetStatus;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly retiredAt: Date | null;
  readonly retireReason: string | null;
}

export class Asset {
  private constructor(private dados: DadosDoAtivo) {}

  static restore(dados: DadosDoAtivo): Asset {
    return new Asset(dados);
  }

  static register(entrada: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    category: string;
    serialNumber?: string | null;
    acquiredOn?: Date | null;
    notes?: string | null;
    agora?: Date;
  }): Asset {
    const agora = entrada.agora ?? new Date();
    return new Asset({
      id: entrada.id,
      tenantId: entrada.tenantId,
      code: entrada.code.trim(),
      name: entrada.name.trim(),
      category: entrada.category.trim(),
      serialNumber: entrada.serialNumber?.trim() || null,
      acquiredOn: entrada.acquiredOn ?? null,
      status: 'active',
      notes: entrada.notes?.trim() || null,
      createdAt: agora,
      updatedAt: agora,
      retiredAt: null,
      retireReason: null,
    });
  }

  get id(): string {
    return this.dados.id;
  }
  get tenantId(): string {
    return this.dados.tenantId;
  }
  get code(): string {
    return this.dados.code;
  }
  get name(): string {
    return this.dados.name;
  }
  get category(): string {
    return this.dados.category;
  }
  get serialNumber(): string | null {
    return this.dados.serialNumber;
  }
  get acquiredOn(): Date | null {
    return this.dados.acquiredOn;
  }
  get status(): AssetStatus {
    return this.dados.status;
  }
  get notes(): string | null {
    return this.dados.notes;
  }
  get createdAt(): Date {
    return this.dados.createdAt;
  }
  get updatedAt(): Date {
    return this.dados.updatedAt;
  }
  get retiredAt(): Date | null {
    return this.dados.retiredAt;
  }
  get retireReason(): string | null {
    return this.dados.retireReason;
  }

  update(
    mudancas: {
      name?: string;
      category?: string;
      serialNumber?: string | null;
      acquiredOn?: Date | null;
      notes?: string | null;
    },
    agora = new Date(),
  ): void {
    // Corrigir cadastro de ativo baixado não muda nada no mundo real, e
    // apagaria o registro do que estava valendo quando ele saiu de operação.
    this.exigirEmOperacao();
    this.dados = {
      ...this.dados,
      name: mudancas.name?.trim() ?? this.dados.name,
      category: mudancas.category?.trim() ?? this.dados.category,
      serialNumber:
        mudancas.serialNumber === undefined
          ? this.dados.serialNumber
          : mudancas.serialNumber?.trim() || null,
      acquiredOn:
        mudancas.acquiredOn === undefined
          ? this.dados.acquiredOn
          : mudancas.acquiredOn,
      notes:
        mudancas.notes === undefined
          ? this.dados.notes
          : mudancas.notes?.trim() || null,
      updatedAt: agora,
    };
  }

  /** Baixa definitiva: venda, perda ou fim de vida útil. Não tem volta. */
  retire(motivo: string | null, agora = new Date()): void {
    this.exigirEmOperacao();
    this.dados = {
      ...this.dados,
      status: 'retired',
      retiredAt: agora,
      retireReason: motivo?.trim() || null,
      updatedAt: agora,
    };
  }

  /** O ativo pode receber bloqueio, correção ou baixa? */
  exigirEmOperacao(): void {
    if (this.dados.status === 'retired') {
      throw new AssetRetiredError(this.dados.code);
    }
  }
}

/**
 * Situação de leitura do ativo — derivada, nunca guardada.
 *
 * `bloqueioVigente` é o bloqueio que cobre o instante consultado, se houver.
 */
export function disponibilidade(
  ativo: Asset,
  bloqueioVigente: AssetHold | null,
): AssetAvailability {
  if (ativo.status === 'retired') {
    return 'retired';
  }
  return bloqueioVigente ? 'held' : 'available';
}
