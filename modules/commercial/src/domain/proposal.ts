import {
  DiscountExceedsSubtotalError,
  EmptyProposalError,
  InvalidProposalItemError,
  InvalidValidityError,
  ProposalExpiredError,
  ProposalNotDecidableError,
  ProposalNotEditableError,
} from './errors';
import { Money } from './money';

/**
 * Proposta comercial.
 *
 * Estados guardados: `draft`, `sent`, `accepted`, `rejected`.
 *
 * `expired` NÃO é guardado — é derivado de `validUntil` a cada leitura. Se
 * fosse coluna, dependeria de alguém rodar um job para virar verdade, e uma
 * proposta vencida ficaria "enviada" até o job passar. Derivando, ela vence
 * no instante certo, sem agendador nenhum.
 */
export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected';

/** O que a leitura enxerga, com o vencimento já aplicado. */
export type ProposalView = ProposalStatus | 'expired';

export interface DadosDoItem {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly discountCents: number;
}

export class ProposalItem {
  private constructor(
    readonly id: string,
    readonly description: string,
    readonly quantity: number,
    readonly unitPrice: Money,
    readonly discount: Money,
  ) {}

  static create(entrada: {
    id: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents?: number;
    currency: string;
  }): ProposalItem {
    const descricao = entrada.description.trim();
    if (descricao.length < 2 || descricao.length > 300) {
      throw new InvalidProposalItemError(
        'a descrição precisa ter entre 2 e 300 caracteres',
      );
    }
    if (!Number.isSafeInteger(entrada.quantity) || entrada.quantity < 1) {
      throw new InvalidProposalItemError('a quantidade precisa ser ao menos 1');
    }

    const unitario = Money.of(entrada.unitPriceCents, entrada.currency);
    if (unitario.isNegative) {
      throw new InvalidProposalItemError(
        'o preço unitário não pode ser negativo',
      );
    }
    const desconto = Money.of(entrada.discountCents ?? 0, entrada.currency);
    if (desconto.isNegative) {
      throw new InvalidProposalItemError('o desconto não pode ser negativo');
    }
    if (desconto.isGreaterThan(unitario.times(entrada.quantity))) {
      throw new DiscountExceedsSubtotalError();
    }

    return new ProposalItem(
      entrada.id,
      descricao,
      entrada.quantity,
      unitario,
      desconto,
    );
  }

  static restore(dados: DadosDoItem, currency: string): ProposalItem {
    return new ProposalItem(
      dados.id,
      dados.description,
      dados.quantity,
      Money.of(dados.unitPriceCents, currency),
      Money.of(dados.discountCents, currency),
    );
  }

  /** Sempre calculado. O cliente informa preço e quantidade, nunca o total. */
  get total(): Money {
    return this.unitPrice.times(this.quantity).minus(this.discount);
  }
}

export interface DadosDaProposta {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly number: number;
  readonly status: ProposalStatus;
  readonly currency: string;
  readonly title: string;
  readonly notes: string | null;
  readonly validUntil: Date;
  readonly items: readonly DadosDoItem[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly sentAt: Date | null;
  readonly decidedAt: Date | null;
}

export class Proposal {
  private constructor(private dados: DadosDaProposta) {}

  static restore(dados: DadosDaProposta): Proposal {
    return new Proposal(dados);
  }

  static create(entrada: {
    id: string;
    tenantId: string;
    customerId: string;
    number: number;
    title: string;
    currency: string;
    validUntil: Date;
    notes?: string | null;
    agora?: Date;
  }): Proposal {
    const agora = entrada.agora ?? new Date();
    if (entrada.validUntil.getTime() <= agora.getTime()) {
      throw new InvalidValidityError();
    }
    // Valida a moeda cedo: descobrir que é inválida só ao somar o primeiro
    // item deixaria uma proposta meio criada.
    Money.zero(entrada.currency);

    return new Proposal({
      id: entrada.id,
      tenantId: entrada.tenantId,
      customerId: entrada.customerId,
      number: entrada.number,
      status: 'draft',
      currency: entrada.currency,
      title: entrada.title.trim(),
      notes: entrada.notes ?? null,
      validUntil: entrada.validUntil,
      items: [],
      createdAt: agora,
      updatedAt: agora,
      sentAt: null,
      decidedAt: null,
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
  get number(): number {
    return this.dados.number;
  }
  get status(): ProposalStatus {
    return this.dados.status;
  }
  get currency(): string {
    return this.dados.currency;
  }
  get title(): string {
    return this.dados.title;
  }
  get notes(): string | null {
    return this.dados.notes;
  }
  get validUntil(): Date {
    return this.dados.validUntil;
  }
  get createdAt(): Date {
    return this.dados.createdAt;
  }
  get updatedAt(): Date {
    return this.dados.updatedAt;
  }
  get sentAt(): Date | null {
    return this.dados.sentAt;
  }
  get decidedAt(): Date | null {
    return this.dados.decidedAt;
  }

  get items(): ProposalItem[] {
    return this.dados.items.map((item) =>
      ProposalItem.restore(item, this.dados.currency),
    );
  }

  /** Soma dos itens. Nunca vem do cliente — é o valor que o negócio combina. */
  get total(): Money {
    return this.items.reduce(
      (soma, item) => soma.plus(item.total),
      Money.zero(this.dados.currency),
    );
  }

  /** Vencida é `sent` que passou da validade — derivado, nunca guardado. */
  estaVencida(agora = new Date()): boolean {
    return (
      this.dados.status === 'sent' &&
      this.dados.validUntil.getTime() <= agora.getTime()
    );
  }

  /** Situação de leitura: o que o usuário e o agente enxergam. */
  situacao(agora = new Date()): ProposalView {
    return this.estaVencida(agora) ? 'expired' : this.dados.status;
  }

  /**
   * Itens só mudam em rascunho: uma proposta enviada é o documento que o
   * cliente recebeu, e alterar valor depois seria mudar o combinado sem que
   * ele soubesse.
   */
  replaceItems(itens: readonly ProposalItem[], agora = new Date()): void {
    this.exigirRascunho();
    for (const item of itens) {
      // Já validado em `ProposalItem.create`, mas o agregado é dono da moeda:
      // reconferir aqui impede montar item numa moeda e anexar em outra.
      item.total.plus(Money.zero(this.dados.currency));
    }
    this.dados = {
      ...this.dados,
      items: itens.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPrice.cents,
        discountCents: item.discount.cents,
      })),
      updatedAt: agora,
    };
  }

  atualizarCabecalho(
    entrada: { title?: string; notes?: string | null; validUntil?: Date },
    agora = new Date(),
  ): void {
    this.exigirRascunho();
    if (entrada.validUntil && entrada.validUntil.getTime() <= agora.getTime()) {
      throw new InvalidValidityError();
    }
    this.dados = {
      ...this.dados,
      title: entrada.title?.trim() ?? this.dados.title,
      notes: entrada.notes === undefined ? this.dados.notes : entrada.notes,
      validUntil: entrada.validUntil ?? this.dados.validUntil,
      updatedAt: agora,
    };
  }

  send(agora = new Date()): void {
    this.exigirRascunho();
    if (this.dados.items.length === 0) {
      throw new EmptyProposalError();
    }
    if (this.dados.validUntil.getTime() <= agora.getTime()) {
      throw new InvalidValidityError();
    }
    this.dados = {
      ...this.dados,
      status: 'sent',
      sentAt: agora,
      updatedAt: agora,
    };
  }

  accept(agora = new Date()): void {
    this.exigirDecidivel(agora);
    this.dados = {
      ...this.dados,
      status: 'accepted',
      decidedAt: agora,
      updatedAt: agora,
    };
  }

  reject(agora = new Date()): void {
    this.exigirDecidivel(agora);
    this.dados = {
      ...this.dados,
      status: 'rejected',
      decidedAt: agora,
      updatedAt: agora,
    };
  }

  private exigirRascunho(): void {
    if (this.dados.status !== 'draft') {
      throw new ProposalNotEditableError(this.dados.status);
    }
  }

  private exigirDecidivel(agora: Date): void {
    if (this.dados.status !== 'sent') {
      throw new ProposalNotDecidableError(this.dados.status);
    }
    // Aceitar proposta vencida é assumir preço que já não vale.
    if (this.estaVencida(agora)) {
      throw new ProposalExpiredError(this.dados.validUntil);
    }
  }
}
