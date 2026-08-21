import type { AccessGrant } from '@ecojotaduo/permissions';
import type { UnitOfWork } from '@ecojotaduo/platform-kernel';

import { entitlementIsValid } from '../domain/tenant';
import { NoActiveMembershipError, TenantNotFoundError } from '../domain/errors';
import type {
  EntitlementContributor,
  EntitlementRepository,
  MembershipRepository,
  TenantRepository,
} from '../ports/repositories';

export interface ResolvedAccess {
  readonly grant: AccessGrant;
  readonly membershipId: string;
  readonly tenantName: string;
}

/**
 * Monta o conjunto efetivo de acesso de um usuário dentro de um tenant.
 *
 * Roda a CADA requisição (o guard da API chama antes do caso de uso), então
 * revogar um papel ou suspender um vínculo tem efeito imediato — não fica
 * esperando o access token expirar.
 *
 * As cinco leituras vão numa **transação só**. O ganho é custo: quatro
 * conexões do pool a menos por requisição autenticada, e um `begin` +
 * `set_config` em vez de cinco. Como isso acontece em TODA rota autenticada,
 * o pool era o primeiro recurso a saturar sob carga.
 *
 * O que isto NÃO dá: foto consistente. O banco roda em `read committed`, e
 * nesse nível cada comando toma o próprio snapshot mesmo dentro da mesma
 * transação. Quem quiser a decisão inteira de um instante só precisa de
 * `repeatable read` — deliberadamente fora daqui, porque o desvio de estado
 * entre as leituras é de milissegundos e sempre no sentido seguro (a
 * contratação lida é a mais recente).
 */
export class ResolveAccessGrantUseCase {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly memberships: MembershipRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly uow: UnitOfWork,
    /** Extensões (plugins) que também concedem acesso quando habilitadas. */
    private readonly contribuidores: readonly EntitlementContributor[] = [],
  ) {}

  async execute(entrada: {
    tenantId: string;
    userId: string;
    scopes: readonly string[];
    agora?: Date;
  }): Promise<ResolvedAccess> {
    return this.uow.executar(entrada.tenantId, () => this.resolver(entrada));
  }

  private async resolver(entrada: {
    tenantId: string;
    userId: string;
    scopes: readonly string[];
    agora?: Date;
  }): Promise<ResolvedAccess> {
    const tenant = await this.tenants.findById(entrada.tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(entrada.tenantId);
    }
    tenant.assertActive();

    const membership = await this.memberships.findActive(
      tenant.id,
      entrada.userId,
    );
    if (!membership) {
      throw new NoActiveMembershipError();
    }

    const [permissions, entitlements, extras] = await Promise.all([
      this.memberships.listPermissions(tenant.id, membership.id),
      this.entitlements.list(tenant.id),
      this.extras(tenant.id),
    ]);

    const agora = entrada.agora ?? new Date();

    return {
      grant: {
        permissions,
        scopes: entrada.scopes,
        entitlements: [
          ...entitlements
            .filter((entitlement) => entitlementIsValid(entitlement, agora))
            .map((entitlement) => entitlement.moduleId),
          ...extras,
        ],
      },
      membershipId: membership.id,
      tenantName: tenant.name,
    };
  }

  /**
   * Service accounts não têm papéis: os escopos concedidos na criação da conta
   * SÃO as permissões, ainda limitadas pelos módulos contratados.
   */
  async executeForServiceAccount(entrada: {
    tenantId: string;
    scopes: readonly string[];
    agora?: Date;
  }): Promise<AccessGrant> {
    return this.uow.executar(entrada.tenantId, () =>
      this.resolverServico(entrada),
    );
  }

  private async resolverServico(entrada: {
    tenantId: string;
    scopes: readonly string[];
    agora?: Date;
  }): Promise<AccessGrant> {
    const tenant = await this.tenants.findById(entrada.tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(entrada.tenantId);
    }
    tenant.assertActive();

    const [entitlements, extras] = await Promise.all([
      this.entitlements.list(tenant.id),
      this.extras(tenant.id),
    ]);
    const agora = entrada.agora ?? new Date();

    return {
      permissions: entrada.scopes,
      scopes: entrada.scopes,
      entitlements: [
        ...entitlements
          .filter((entitlement) => entitlementIsValid(entitlement, agora))
          .map((entitlement) => entitlement.moduleId),
        ...extras,
      ],
    };
  }

  /**
   * Entitlements vindos de extensões (hoje, plugins habilitados).
   *
   * Uma consulta a mais por requisição, hoje dentro da mesma transação das
   * demais. O caminho contrário (guardar o resultado num token) seria pior:
   * desabilitar um plugin demoraria a valer, que é exatamente o que esta
   * cadeia existe para evitar.
   */
  private async extras(tenantId: string): Promise<string[]> {
    if (this.contribuidores.length === 0) {
      return [];
    }
    const listas = await Promise.all(
      this.contribuidores.map((contribuidor) =>
        contribuidor.listEntitlements(tenantId),
      ),
    );
    return listas.flat();
  }
}
