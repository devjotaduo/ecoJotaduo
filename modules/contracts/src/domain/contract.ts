import {
  ContractNotActiveError,
  ContractNotDraftError,
  ContractTermEndedError,
  InvalidContractTermError,
} from './errors';

/**
 * Contrato: o compromisso que nasce de uma proposta aceita.
 *
 * Estados guardados: `draft`, `active`, `finished`, `canceled`.
 *
 * Como na proposta, **`expired` não é guardado** — é derivado de `endsOn`. Um
 * contrato cuja vigência acabou não está mais valendo, tenha ou não passado
 * alguém para encerrá-lo. Se dependesse de um job, ficaria "ativo" até o job
 * rodar, e é dessa janela que saem cobranças fora de vigência.
 */
export type ContractStatus = 'draft' | 'active' | 'finished' | 'canceled';

/** O que a leitura enxerga, com a vigência já aplicada. */
export type ContractView = ContractStatus | 'expired';

export interface DadosDoContrato {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  /** Proposta de origem. Um contrato não nasce do nada. */
  readonly proposalId: string;
  readonly number: number;
  readonly status: ContractStatus;
  readonly title: string;
  readonly currency: string;
  /** Copiado da proposta aceita — não é informado por quem cria. */
  readonly valueCents: number;
  readonly startsOn: Date;
  readonly endsOn: Date;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly activatedAt: Date | null;
  readonly closedAt: Date | null;
  readonly closeReason: string | null;
}

export class Contract {
  private constructor(private dados: DadosDoContrato) {}

  static restore(dados: DadosDoContrato): Contract {
    return new Contract(dados);
  }

  static draft(entrada: {
    id: string;
    tenantId: string;
    customerId: string;
    proposalId: string;
    number: number;
    title: string;
    currency: string;
    valueCents: number;
    startsOn: Date;
    endsOn: Date;
    notes?: string | null;
    agora?: Date;
  }): Contract {
    const agora = entrada.agora ?? new Date();
    if (entrada.endsOn.getTime() <= entrada.startsOn.getTime()) {
      throw new InvalidContractTermError(
        'o término precisa ser depois do início',
      );
    }
    if (entrada.endsOn.getTime() <= agora.getTime()) {
      throw new InvalidContractTermError('a vigência já teria terminado');
    }

    return new Contract({
      id: entrada.id,
      tenantId: entrada.tenantId,
      customerId: entrada.customerId,
      proposalId: entrada.proposalId,
      number: entrada.number,
      status: 'draft',
      title: entrada.title.trim(),
      currency: entrada.currency,
      valueCents: entrada.valueCents,
      startsOn: entrada.startsOn,
      endsOn: entrada.endsOn,
      notes: entrada.notes ?? null,
      createdAt: agora,
      updatedAt: agora,
      activatedAt: null,
      closedAt: null,
      closeReason: null,
    });
  }

  get id(): string {
    return this.dados.id;
  }
  get tenantId(): string {
    return this.dados.tenantId;
  }
  get customerId(): string {
    return this.dados.customerId;
  }
  get proposalId(): string {
    return this.dados.proposalId;
  }
  get number(): number {
    return this.dados.number;
  }
  get status(): ContractStatus {
    return this.dados.status;
  }
  get title(): string {
    return this.dados.title;
  }
  get currency(): string {
    return this.dados.currency;
  }
  get valueCents(): number {
    return this.dados.valueCents;
  }
  get startsOn(): Date {
    return this.dados.startsOn;
  }
  get endsOn(): Date {
    return this.dados.endsOn;
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
  get activatedAt(): Date | null {
    return this.dados.activatedAt;
  }
  get closedAt(): Date | null {
    return this.dados.closedAt;
  }
  get closeReason(): string | null {
    return this.dados.closeReason;
  }

  /** Vigência encerrada com o contrato ainda ativo — derivado, não guardado. */
  vigenciaEncerrada(agora = new Date()): boolean {
    return (
      this.dados.status === 'active' &&
      this.dados.endsOn.getTime() <= agora.getTime()
    );
  }

  situacao(agora = new Date()): ContractView {
    return this.vigenciaEncerrada(agora) ? 'expired' : this.dados.status;
  }

  /** Em vigor AGORA: ativo, começado e dentro do prazo. */
  emVigor(agora = new Date()): boolean {
    return (
      this.dados.status === 'active' &&
      this.dados.startsOn.getTime() <= agora.getTime() &&
      this.dados.endsOn.getTime() > agora.getTime()
    );
  }

  activate(agora = new Date()): void {
    if (this.dados.status !== 'draft') {
      throw new ContractNotDraftError(this.dados.status);
    }
    // Ativar um contrato cuja vigência já passou criaria um contrato nascido
    // vencido — sinal de data errada, não de operação válida.
    if (this.dados.endsOn.getTime() <= agora.getTime()) {
      throw new ContractTermEndedError(this.dados.endsOn);
    }
    this.dados = {
      ...this.dados,
      status: 'active',
      activatedAt: agora,
      updatedAt: agora,
    };
  }

  /** Encerramento normal: o contrato cumpriu o que tinha para cumprir. */
  finish(motivo: string | null, agora = new Date()): void {
    this.exigirAtivo();
    this.fechar('finished', motivo, agora);
  }

  /** Cancelamento: interrompido antes do fim previsto. */
  cancel(motivo: string | null, agora = new Date()): void {
    this.exigirAtivo();
    this.fechar('canceled', motivo, agora);
  }

  private exigirAtivo(): void {
    // Vale mesmo com a vigência encerrada: encerrar formalmente o que já
    // venceu é operação legítima — é assim que a situação para de ser
    // `expired` e vira `finished`.
    if (this.dados.status !== 'active') {
      throw new ContractNotActiveError(this.dados.status);
    }
  }

  private fechar(
    status: 'finished' | 'canceled',
    motivo: string | null,
    agora: Date,
  ): void {
    this.dados = {
      ...this.dados,
      status,
      closedAt: agora,
      closeReason: motivo?.trim() || null,
      updatedAt: agora,
    };
  }
}
