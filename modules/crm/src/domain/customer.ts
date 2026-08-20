import { CustomerDocument } from './document';
import { CustomerArchivedError, InvalidCustomerNameError } from './errors';

export type CustomerStatus = 'active' | 'archived';

export interface CustomerProps {
  readonly id: string;
  readonly name: string;
  readonly document: CustomerDocument | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: CustomerStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const NOME_MINIMO = 2;
const NOME_MAXIMO = 200;

function normalizarNome(valor: string): string {
  const nome = valor.trim().replace(/\s+/g, ' ');
  if (nome.length < NOME_MINIMO || nome.length > NOME_MAXIMO) {
    throw new InvalidCustomerNameError();
  }
  return nome;
}

export class Customer {
  private constructor(private props: CustomerProps) {}

  static create(entrada: {
    id: string;
    name: string;
    document?: string | null;
    email?: string | null;
    phone?: string | null;
    agora?: Date;
  }): Customer {
    const agora = entrada.agora ?? new Date();
    return new Customer({
      id: entrada.id,
      name: normalizarNome(entrada.name),
      document: entrada.document
        ? CustomerDocument.create(entrada.document)
        : null,
      email: entrada.email?.trim().toLowerCase() || null,
      phone: entrada.phone?.replace(/\D/g, '') || null,
      status: 'active',
      createdAt: agora,
      updatedAt: agora,
    });
  }

  static restore(props: CustomerProps): Customer {
    return new Customer(props);
  }

  get id(): string {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }
  get document(): CustomerDocument | null {
    return this.props.document;
  }
  get email(): string | null {
    return this.props.email;
  }
  get phone(): string | null {
    return this.props.phone;
  }
  get status(): CustomerStatus {
    return this.props.status;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get isActive(): boolean {
    return this.props.status === 'active';
  }

  /**
   * Cliente arquivado permanece consultável (histórico é fato), mas não
   * recebe nota nem agendamento novo.
   */
  assertAceitaInteracao(): void {
    if (!this.isActive) {
      throw new CustomerArchivedError();
    }
  }

  update(
    alteracoes: {
      name?: string;
      document?: string | null;
      email?: string | null;
      phone?: string | null;
    },
    agora: Date = new Date(),
  ): void {
    this.props = {
      ...this.props,
      name:
        alteracoes.name === undefined
          ? this.props.name
          : normalizarNome(alteracoes.name),
      document:
        alteracoes.document === undefined
          ? this.props.document
          : alteracoes.document
            ? CustomerDocument.create(alteracoes.document)
            : null,
      email:
        alteracoes.email === undefined
          ? this.props.email
          : alteracoes.email?.trim().toLowerCase() || null,
      phone:
        alteracoes.phone === undefined
          ? this.props.phone
          : alteracoes.phone?.replace(/\D/g, '') || null,
      updatedAt: agora,
    };
  }

  archive(agora: Date = new Date()): void {
    this.props = { ...this.props, status: 'archived', updatedAt: agora };
  }
}
