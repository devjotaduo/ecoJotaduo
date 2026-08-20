import { Email } from '../domain/email';
import { InvalidCredentialsError } from '../domain/errors';
import type { PasswordHasher, UserRepository } from '../ports/repositories';

export interface VerifiedUser {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
}

/**
 * Verifica e-mail + senha. Não emite token nem conhece tenant: quem compõe a
 * sessão é o módulo tenancy, que sabe de vínculos e permissões.
 */
export class VerifyCredentialsUseCase {
  constructor(
    private readonly usuarios: UserRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(entrada: {
    email: string;
    password: string;
  }): Promise<VerifiedUser> {
    let email: Email;
    try {
      email = Email.create(entrada.email);
    } catch {
      // E-mail malformado é tratado como credencial inválida: a resposta ao
      // cliente precisa ser idêntica à de senha errada.
      throw new InvalidCredentialsError();
    }

    const usuario = await this.usuarios.findByEmail(email.value);
    if (!usuario) {
      throw new InvalidCredentialsError();
    }

    const senhaConfere = await this.hasher.verify(
      entrada.password,
      usuario.passwordHash,
    );
    if (!senhaConfere) {
      throw new InvalidCredentialsError();
    }

    usuario.assertCanAuthenticate();

    return {
      userId: usuario.id,
      name: usuario.name,
      email: usuario.email.value,
    };
  }
}
