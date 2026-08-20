import { Email } from './email';
import { UserNotActiveError } from './errors';

export type UserStatus = 'active' | 'suspended' | 'disabled';

export interface UserProps {
  readonly id: string;
  readonly email: Email;
  readonly name: string;
  readonly status: UserStatus;
  readonly passwordHash: string;
}

/**
 * Entidade de usuário. Puro: não conhece banco, framework nem HTTP.
 * A verificação da senha em si é responsabilidade de uma porta (o domínio
 * não escolhe algoritmo de hash), mas a regra "só usuário ativo autentica"
 * mora aqui.
 */
export class User {
  private constructor(private readonly props: UserProps) {}

  static restore(props: UserProps): User {
    return new User(props);
  }

  get id(): string {
    return this.props.id;
  }

  get email(): Email {
    return this.props.email;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get isActive(): boolean {
    return this.props.status === 'active';
  }

  assertCanAuthenticate(): void {
    if (!this.isActive) {
      throw new UserNotActiveError();
    }
  }
}
