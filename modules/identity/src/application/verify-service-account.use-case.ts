import { InvalidCredentialsError } from '../domain/errors';
import type {
  SecretHasher,
  ServiceAccountRepository,
} from '../ports/repositories';

export interface VerifiedServiceAccount {
  readonly serviceAccountId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: readonly string[];
}

/** Autenticação máquina-a-máquina: client_id + client_secret. */
export class VerifyServiceAccountUseCase {
  constructor(
    private readonly contas: ServiceAccountRepository,
    private readonly hasher: SecretHasher,
  ) {}

  async execute(entrada: {
    clientId: string;
    clientSecret: string;
  }): Promise<VerifiedServiceAccount> {
    const conta = await this.contas.findByClientId(entrada.clientId);
    if (!conta || conta.status !== 'active') {
      throw new InvalidCredentialsError();
    }

    if (!this.hasher.matches(entrada.clientSecret, conta.secretHash)) {
      throw new InvalidCredentialsError();
    }

    return {
      serviceAccountId: conta.id,
      tenantId: conta.tenantId,
      name: conta.name,
      scopes: conta.scopes,
    };
  }
}
