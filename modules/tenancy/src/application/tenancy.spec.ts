import { NoopAuditLogger } from '@ecojotaduo/audit';
import type { IdentityPublicApi } from '@ecojotaduo/identity';
import { authorize } from '@ecojotaduo/permissions';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ModuleAlreadyEntitledError,
  NoActiveMembershipError,
  TenantNotActiveError,
  TenantNotFoundError,
  UnknownModuleError,
} from '../domain/errors';
import { Tenant, entitlementIsValid, type Entitlement } from '../domain/tenant';
import type {
  AccessTokenIssuer,
  EntitlementRepository,
  MembershipRepository,
  TenantRepository,
} from '../ports/repositories';

import { IssueServiceTokenUseCase } from './issue-service-token.use-case';
import { ManageEntitlementsUseCase } from './manage-entitlements.use-case';
import { ResolveAccessGrantUseCase } from './resolve-access-grant.use-case';
import { SignInUseCase } from './sign-in.use-case';

const TENANT_A = '019a0000-0000-7000-8000-00000000000a';
const TENANT_B = '019a0000-0000-7000-8000-00000000000b';
const USUARIO = '019a0000-0000-7000-8000-000000000001';

function tenant(
  id = TENANT_A,
  status: 'active' | 'suspended' = 'active',
): Tenant {
  return Tenant.restore({
    id,
    organizationId: 'org-1',
    slug: id === TENANT_A ? 'empresa-a' : 'empresa-b',
    name: id === TENANT_A ? 'Empresa A' : 'Empresa B',
    status,
  });
}

class TenantsFake implements TenantRepository {
  constructor(
    private readonly registros: Tenant[],
    /** Empresas visíveis ao usuário; vazio = todas (simplifica os testes). */
    private readonly visiveis: readonly string[] = [],
  ) {}
  findBySlugForUser(slug: string): Promise<Tenant | null> {
    const achado = this.registros.find((t) => t.slug === slug) ?? null;
    if (
      achado &&
      this.visiveis.length > 0 &&
      !this.visiveis.includes(achado.id)
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(achado);
  }
  findById(id: string): Promise<Tenant | null> {
    return Promise.resolve(this.registros.find((t) => t.id === id) ?? null);
  }
  listForUser(): Promise<never[]> {
    return Promise.resolve([]);
  }
}

class MembershipsFake implements MembershipRepository {
  constructor(
    private readonly vinculos: { tenantId: string; userId: string }[],
    private readonly permissoes: string[] = [],
  ) {}
  findActive(tenantId: string, userId: string) {
    const achou = this.vinculos.some(
      (v) => v.tenantId === tenantId && v.userId === userId,
    );
    return Promise.resolve(
      achou
        ? { id: `m-${tenantId}`, tenantId, userId, status: 'active' as const }
        : null,
    );
  }
  listPermissions(): Promise<string[]> {
    return Promise.resolve(this.permissoes);
  }
}

class EntitlementsFake implements EntitlementRepository {
  constructor(public registros: Entitlement[] = []) {}
  list(): Promise<Entitlement[]> {
    return Promise.resolve(this.registros);
  }
  find(_tenantId: string, moduleId: string): Promise<Entitlement | null> {
    return Promise.resolve(
      this.registros.find((e) => e.moduleId === moduleId) ?? null,
    );
  }
  grant(input: { moduleId: string; expiresAt: Date | null }): Promise<void> {
    this.registros = [
      ...this.registros.filter((e) => e.moduleId !== input.moduleId),
      {
        moduleId: input.moduleId,
        status: 'active',
        expiresAt: input.expiresAt,
      },
    ];
    return Promise.resolve();
  }
  revoke(_tenantId: string, moduleId: string): Promise<void> {
    this.registros = this.registros.map((e) =>
      e.moduleId === moduleId ? { ...e, status: 'suspended' as const } : e,
    );
    return Promise.resolve();
  }
}

const emissor: AccessTokenIssuer = {
  issue: ({ subject, tenantId }) => ({
    token: `token:${subject}:${tenantId}`,
    expiresAt: new Date(Date.now() + 900_000),
  }),
};

describe('entitlementIsValid', () => {
  it('aceita contratação ativa sem validade', () => {
    expect(
      entitlementIsValid({
        moduleId: 'crm',
        status: 'active',
        expiresAt: null,
      }),
    ).toBe(true);
  });

  it('recusa contratação suspensa ou vencida', () => {
    const ontem = new Date(Date.now() - 86_400_000);
    expect(
      entitlementIsValid({
        moduleId: 'crm',
        status: 'suspended',
        expiresAt: null,
      }),
    ).toBe(false);
    expect(
      entitlementIsValid({
        moduleId: 'crm',
        status: 'active',
        expiresAt: ontem,
      }),
    ).toBe(false);
  });
});

describe('ResolveAccessGrantUseCase', () => {
  it('junta permissões dos papéis com módulos contratados', async () => {
    const caso = new ResolveAccessGrantUseCase(
      new TenantsFake([tenant()]),
      new MembershipsFake(
        [{ tenantId: TENANT_A, userId: USUARIO }],
        ['crm.customer.read'],
      ),
      new EntitlementsFake([
        { moduleId: 'crm', status: 'active', expiresAt: null },
        { moduleId: 'finance', status: 'suspended', expiresAt: null },
      ]),
    );

    const { grant } = await caso.execute({
      tenantId: TENANT_A,
      userId: USUARIO,
      scopes: ['*'],
    });

    expect(grant.permissions).toEqual(['crm.customer.read']);
    // O módulo suspenso não entra: fica de fora do acesso efetivo.
    expect(grant.entitlements).toEqual(['crm']);
    expect(authorize(grant, 'crm.customer.read').allowed).toBe(true);
    expect(authorize(grant, 'finance.invoice.read').allowed).toBe(false);
  });

  it('recusa usuário sem vínculo ativo no tenant', async () => {
    const caso = new ResolveAccessGrantUseCase(
      new TenantsFake([tenant()]),
      new MembershipsFake([{ tenantId: TENANT_B, userId: USUARIO }]),
      new EntitlementsFake(),
    );

    await expect(
      caso.execute({ tenantId: TENANT_A, userId: USUARIO, scopes: ['*'] }),
    ).rejects.toThrow(NoActiveMembershipError);
  });

  it('recusa tenant suspenso mesmo com vínculo válido', async () => {
    const caso = new ResolveAccessGrantUseCase(
      new TenantsFake([tenant(TENANT_A, 'suspended')]),
      new MembershipsFake([{ tenantId: TENANT_A, userId: USUARIO }], ['*']),
      new EntitlementsFake(),
    );

    await expect(
      caso.execute({ tenantId: TENANT_A, userId: USUARIO, scopes: ['*'] }),
    ).rejects.toThrow(TenantNotActiveError);
  });

  it('service account recebe as permissões dos próprios escopos', async () => {
    const caso = new ResolveAccessGrantUseCase(
      new TenantsFake([tenant()]),
      new MembershipsFake([]),
      new EntitlementsFake([
        { moduleId: 'crm', status: 'active', expiresAt: null },
      ]),
    );

    const grant = await caso.executeForServiceAccount({
      tenantId: TENANT_A,
      scopes: ['crm.customer.read'],
    });

    expect(authorize(grant, 'crm.customer.read').allowed).toBe(true);
    expect(authorize(grant, 'crm.customer.create').allowed).toBe(false);
  });
});

describe('SignInUseCase', () => {
  const identity = {
    verifyCredentials: () =>
      Promise.resolve({
        userId: USUARIO,
        name: 'Maria',
        email: 'maria@a.com.br',
      }),
    issueRefreshToken: () =>
      Promise.resolve({
        id: 'r1',
        token: 'refresh-1',
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
  } as unknown as IdentityPublicApi;

  function montar(
    tenants: Tenant[],
    vinculos: { tenantId: string; userId: string }[],
  ) {
    const resolver = new ResolveAccessGrantUseCase(
      new TenantsFake(tenants),
      new MembershipsFake(vinculos, ['*']),
      new EntitlementsFake([
        { moduleId: 'crm', status: 'active', expiresAt: null },
      ]),
    );
    return new SignInUseCase(
      identity,
      new TenantsFake(tenants),
      resolver,
      emissor,
    );
  }

  it('emite sessão presa ao tenant do login', async () => {
    const caso = montar([tenant()], [{ tenantId: TENANT_A, userId: USUARIO }]);

    const sessao = await caso.execute({
      email: 'maria@a.com.br',
      password: 'x',
      tenantSlug: 'empresa-a',
    });

    expect(sessao.accessToken).toBe(`token:${USUARIO}:${TENANT_A}`);
    expect(sessao.tenant.id).toBe(TENANT_A);
    expect(sessao.entitlements).toEqual(['crm']);
  });

  it('nega login em empresa onde o usuário não tem vínculo', async () => {
    const caso = montar(
      [tenant(TENANT_A), tenant(TENANT_B)],
      [{ tenantId: TENANT_A, userId: USUARIO }],
    );

    await expect(
      caso.execute({
        email: 'maria@a.com.br',
        password: 'x',
        tenantSlug: 'empresa-b',
      }),
    ).rejects.toThrow(NoActiveMembershipError);
  });

  it('recusa empresa inexistente', async () => {
    const caso = montar([tenant()], [{ tenantId: TENANT_A, userId: USUARIO }]);
    await expect(
      caso.execute({
        email: 'maria@a.com.br',
        password: 'x',
        tenantSlug: 'nao-existe',
      }),
    ).rejects.toThrow(TenantNotFoundError);
  });
});

describe('IssueServiceTokenUseCase', () => {
  it('emite token no tenant da própria conta (cliente não escolhe)', async () => {
    const identity = {
      verifyServiceAccount: () =>
        Promise.resolve({
          serviceAccountId: 'sa-1',
          tenantId: TENANT_B,
          name: 'ERP',
          scopes: ['crm.customer.read'],
        }),
    } as unknown as IdentityPublicApi;

    const caso = new IssueServiceTokenUseCase(
      identity,
      new TenantsFake([tenant(TENANT_A), tenant(TENANT_B)]),
      emissor,
    );

    const resultado = await caso.execute({ clientId: 'c', clientSecret: 's' });

    expect(resultado.tenantId).toBe(TENANT_B);
    expect(resultado.accessToken).toBe(`token:sa-1:${TENANT_B}`);
  });
});

describe('ManageEntitlementsUseCase', () => {
  let repositorio: EntitlementsFake;
  let audit: NoopAuditLogger;
  let caso: ManageEntitlementsUseCase;

  beforeEach(() => {
    repositorio = new EntitlementsFake();
    audit = new NoopAuditLogger();
    caso = new ManageEntitlementsUseCase(repositorio, audit, [
      'crm',
      'finance',
    ]);
  });

  it('contrata módulo conhecido e audita', async () => {
    await caso.grant({ tenantId: TENANT_A, moduleId: 'crm' });

    expect(await caso.list(TENANT_A)).toEqual([
      { moduleId: 'crm', status: 'active', expiresAt: null },
    ]);
    expect(audit.entries[0]).toMatchObject({
      action: 'tenancy.module.granted',
      resourceId: 'crm',
    });
  });

  it('recusa módulo inexistente na instalação', async () => {
    await expect(
      caso.grant({ tenantId: TENANT_A, moduleId: 'modulo-inventado' }),
    ).rejects.toThrow(UnknownModuleError);
  });

  it('recusa contratar duas vezes o mesmo módulo ativo', async () => {
    await caso.grant({ tenantId: TENANT_A, moduleId: 'crm' });
    await expect(
      caso.grant({ tenantId: TENANT_A, moduleId: 'crm' }),
    ).rejects.toThrow(ModuleAlreadyEntitledError);
  });

  it('permite recontratar módulo cancelado', async () => {
    await caso.grant({ tenantId: TENANT_A, moduleId: 'crm' });
    await caso.revoke({ tenantId: TENANT_A, moduleId: 'crm' });

    expect(await caso.list(TENANT_A)).toEqual([]);
    await expect(
      caso.grant({ tenantId: TENANT_A, moduleId: 'crm' }),
    ).resolves.toBeUndefined();
  });

  it('cancelamento é auditado', async () => {
    await caso.grant({ tenantId: TENANT_A, moduleId: 'finance' });
    await caso.revoke({ tenantId: TENANT_A, moduleId: 'finance' });

    expect(audit.entries.map((e) => e.action)).toEqual([
      'tenancy.module.granted',
      'tenancy.module.revoked',
    ]);
  });
});
