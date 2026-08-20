import { EmptyNoteError } from './errors';

const TAMANHO_MAXIMO = 5000;

export interface NoteProps {
  readonly id: string;
  readonly customerId: string;
  readonly body: string;
  readonly authorId: string;
  readonly createdAt: Date;
}

/**
 * Nota de relacionamento com o cliente.
 *
 * É append-only de propósito: histórico de CRM vale como registro do que foi
 * dito e quando. Correção se faz com uma nota nova, não reescrevendo a antiga.
 */
export class CustomerNote {
  private constructor(private readonly props: NoteProps) {}

  static create(entrada: {
    id: string;
    customerId: string;
    body: string;
    authorId: string;
    agora?: Date;
  }): CustomerNote {
    const corpo = entrada.body.trim();
    if (corpo.length === 0 || corpo.length > TAMANHO_MAXIMO) {
      throw new EmptyNoteError();
    }

    return new CustomerNote({
      id: entrada.id,
      customerId: entrada.customerId,
      body: corpo,
      authorId: entrada.authorId,
      createdAt: entrada.agora ?? new Date(),
    });
  }

  static restore(props: NoteProps): CustomerNote {
    return new CustomerNote(props);
  }

  get id(): string {
    return this.props.id;
  }
  get customerId(): string {
    return this.props.customerId;
  }
  get body(): string {
    return this.props.body;
  }
  get authorId(): string {
    return this.props.authorId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
