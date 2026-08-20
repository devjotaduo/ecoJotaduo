import { describe, expect, it } from 'vitest';

import {
  RefreshTokenInvalidError,
  RefreshTokenUseCase,
} from '../src/application/refresh-token.use-case';
import { VerifyCredentialsUseCase } from '../src/application/verify-credentials.use-case';
import { VerifyServiceAccountUseCase } from '../src/application/verify-service-account.use-case';
import { Email } from '../src/domain/email';
import {
  InvalidCredentialsError,
  InvalidEmailError,
  UserNotActiveError,
} from '../src/domain/errors';
import { User, type UserStatus } from '../src/domain/user';
import type {
  PasswordHasher,
  RefreshTokenRecord,
  RefreshTokenRepository,
  SecretHasher,
  ServiceAccountRecord,
  ServiceAccountRepository,
  UserRepository,
} from '../src/ports/repositories';

const HASH = 'scrypt$hash-fake';

function usuario(status: UserStatus = 'active'): User {
  return User.restore({
    id: '019a0000-0000-7000-8000-000000000001',
    email: Email.create('maria@empresa.com.br'),
    name: 'Maria',
    status,
    passwordHash: HASH,
  });
}

const hasherQueAceita: PasswordHasher = {
  verify: () => Promise.resolve(true),
  hash: () => Promise.resolve(HASH),
};
const hasherQueRecusa: PasswordHasher = {
  verify: () => Promise.resolve(false),
  hash: () => Promise.resolve(HASH),
};

function repositorioCom(user: User | null): UserRepository {
  return {
    findByEmail: () => Promise.resolve(user),
    findById: () => Promise.resolve(user),
  };
}

describe('Email (value object)', () => {
  it('normaliza para minúsculas e remove espaços', () => {
    expect(Email.create('  Maria@Empresa.COM.br ').value).toBe(
      'maria@empresa.com.br',
    );
  });

  it('recusa formatos inválidos', () => {
    for (const invalido of [
      '',
      'maria',
      'maria@',
      '@empresa.com',
      'maria@empresa',
    ]) {
      expect(() => Email.create(invalido)).toThrow(InvalidEmailError);
    }
  });

  it('compara por valor normalizado', () => {
    expect(Email.create('A@b.com').equals(Email.create('a@B.com'))).toBe(true);
  });
});

describe('User (entidade)', () => {
  it('permite autenticar quando ativo', () => {
    expect(() => usuario('active').assertCanAuthenticate()).not.toThrow();
  });

  it('bloqueia usuário suspenso ou desativado', () => {
    expect(() => usuario('suspended').assertCanAuthenticate()).toThrow(
      UserNotActiveError,
    );
    expect(() => usuario('disabled').assertCanAuthenticate()).toThrow(
      UserNotActiveError,
    );
  });
});

describe('VerifyCredentialsUseCase', () => {
  it('autentica com senha correta', async () => {
    const caso = new VerifyCredentialsUseCase(
      repositorioCom(usuario()),
      hasherQueAceita,
    );
    await expect(
      caso.execute({ email: 'maria@empresa.com.br', password: 'x' }),
    ).resolves.toMatchObject({ name: 'Maria' });
  });

  it('dá a MESMA resposta para usuário inexistente e senha errada', async () => {
    const inexistente = new VerifyCredentialsUseCase(
      repositorioCom(null),
      hasherQueAceita,
    );
    const senhaErrada = new VerifyCredentialsUseCase(
      repositorioCom(usuario()),
      hasherQueRecusa,
    );

    const erroA = await inexistente
      .execute({ email: 'ninguem@empresa.com.br', password: 'x' })
      .catch((erro: unknown) => erro);
    const erroB = await senhaErrada
      .execute({ email: 'maria@empresa.com.br', password: 'errada' })
      .catch((erro: unknown) => erro);

    expect(erroA).toBeInstanceOf(InvalidCredentialsError);
    expect(erroB).toBeInstanceOf(InvalidCredentialsError);
    expect((erroA as Error).message).toBe((erroB as Error).message);
  });

  it('trata e-mail malformado como credencial inválida (sem vazar validação)', async () => {
    const caso = new VerifyCredentialsUseCase(
      repositorioCom(null),
      hasherQueAceita,
    );
    await expect(
      caso.execute({ email: 'nao-e-email', password: 'x' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('recusa usuário inativo mesmo com senha correta', async () => {
    const caso = new VerifyCredentialsUseCase(
      repositorioCom(usuario('suspended')),
      hasherQueAceita,
    );
    await expect(
      caso.execute({ email: 'maria@empresa.com.br', password: 'x' }),
    ).rejects.toThrow(UserNotActiveError);
  });
});

describe('VerifyServiceAccountUseCase', () => {
  const conta: ServiceAccountRecord = {
    id: 'sa-1',
    tenantId: '019a0000-0000-7000-8000-00000000000a',
    name: 'Integração ERP',
    clientId: 'cli_1',
    secretHash: 'hash',
    scopes: ['crm.customer.read'],
    status: 'active',
  };
  const repo = (
    registro: ServiceAccountRecord | null,
  ): ServiceAccountRepository => ({
    findByClientId: () => Promise.resolve(registro),
  });
  const segredoOk: SecretHasher = { hash: () => 'hash', matches: () => true };
  const segredoRuim: SecretHasher = {
    hash: () => 'hash',
    matches: () => false,
  };

  it('autentica e devolve tenant e escopos da conta', async () => {
    const caso = new VerifyServiceAccountUseCase(repo(conta), segredoOk);
    await expect(
      caso.execute({ clientId: 'cli_1', clientSecret: 's' }),
    ).resolves.toMatchObject({
      tenantId: conta.tenantId,
      scopes: ['crm.customer.read'],
    });
  });

  it('recusa segredo errado, conta inexistente ou desativada', async () => {
    const casos = [
      new VerifyServiceAccountUseCase(repo(conta), segredoRuim),
      new VerifyServiceAccountUseCase(repo(null), segredoOk),
      new VerifyServiceAccountUseCase(
        repo({ ...conta, status: 'disabled' }),
        segredoOk,
      ),
    ];
    for (const caso of casos) {
      await expect(
        caso.execute({ clientId: 'cli_1', clientSecret: 's' }),
      ).rejects.toThrow(InvalidCredentialsError);
    }
  });
});

describe('RefreshTokenUseCase (rotação)', () => {
  class RepositorioEmMemoria implements RefreshTokenRepository {
    readonly registros = new Map<
      string,
      RefreshTokenRecord & { tokenHash: string }
    >();

    save(input: {
      id: string;
      userId: string;
      tenantId: string;
      tokenHash: string;
      expiresAt: Date;
    }): Promise<void> {
      this.registros.set(input.tokenHash, { ...input, revokedAt: null });
      return Promise.resolve();
    }

    findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
      return Promise.resolve(this.registros.get(tokenHash) ?? null);
    }

    revoke(id: string): Promise<void> {
      for (const registro of this.registros.values()) {
        if (registro.id === id) {
          this.registros.set(registro.tokenHash, {
            ...registro,
            revokedAt: new Date(),
          });
        }
      }
      return Promise.resolve();
    }

    revokeAllOfUser(userId: string): Promise<void> {
      for (const registro of this.registros.values()) {
        if (registro.userId === userId) {
          this.registros.set(registro.tokenHash, {
            ...registro,
            revokedAt: new Date(),
          });
        }
      }
      return Promise.resolve();
    }
  }

  const hasher: SecretHasher = {
    hash: (segredo) => `h:${segredo}`,
    matches: (segredo, hash) => `h:${segredo}` === hash,
  };
  let contador = 0;
  const gerador = { create: () => `token-${++contador}` };

  function montar() {
    const repo = new RepositorioEmMemoria();
    return { repo, caso: new RefreshTokenUseCase(repo, hasher, gerador, 30) };
  }

  it('emite token com validade calculada a partir do TTL', async () => {
    const { caso } = montar();
    const agora = new Date('2026-08-20T12:00:00Z');
    const emitido = await caso.issue({ userId: 'u1', tenantId: 't1' }, agora);

    expect(emitido.expiresAt.toISOString()).toBe('2026-09-19T12:00:00.000Z');
  });

  it('rotaciona: o token antigo deixa de valer e um novo é emitido', async () => {
    const { caso } = montar();
    const primeiro = await caso.issue({ userId: 'u1', tenantId: 't1' });

    const resultado = await caso.rotate(primeiro.token);
    expect(resultado.userId).toBe('u1');
    expect(resultado.refresh.token).not.toBe(primeiro.token);

    await expect(caso.rotate(primeiro.token)).rejects.toThrow(
      RefreshTokenInvalidError,
    );
  });

  it('reuso de token revogado invalida TODA a família do usuário', async () => {
    const { caso } = montar();
    const primeiro = await caso.issue({ userId: 'u1', tenantId: 't1' });
    const segundo = await caso.rotate(primeiro.token);

    // Ataque: alguém tenta reusar o token antigo já rotacionado.
    await expect(caso.rotate(primeiro.token)).rejects.toThrow(
      RefreshTokenInvalidError,
    );

    // O token legítimo em uso também é derrubado — exige novo login.
    await expect(caso.rotate(segundo.refresh.token)).rejects.toThrow(
      RefreshTokenInvalidError,
    );
  });

  it('recusa token expirado', async () => {
    const { caso } = montar();
    const agora = new Date('2026-08-20T12:00:00Z');
    const emitido = await caso.issue({ userId: 'u1', tenantId: 't1' }, agora);

    const depois = new Date('2026-09-20T12:00:01Z');
    await expect(caso.rotate(emitido.token, depois)).rejects.toThrow(
      RefreshTokenInvalidError,
    );
  });

  it('recusa token desconhecido', async () => {
    const { caso } = montar();
    await expect(caso.rotate('token-inventado')).rejects.toThrow(
      RefreshTokenInvalidError,
    );
  });
});
