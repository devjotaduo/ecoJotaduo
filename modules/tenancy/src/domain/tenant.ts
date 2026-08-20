import { TenantNotActiveError } from './errors';

export type TenantStatus = 'active' | 'suspended' | 'archived';
export type MembershipStatus = 'active' | 'invited' | 'revoked';
export type EntitlementStatus = 'active' | 'suspended';

export interface TenantProps {
  readonly id: string;
  readonly organizationId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
}

export class Tenant {
  private constructor(private readonly props: TenantProps) {}

  static restore(props: TenantProps): Tenant {
    return new Tenant(props);
  }

  get id(): string {
    return this.props.id;
  }

  get slug(): string {
    return this.props.slug;
  }

  get name(): string {
    return this.props.name;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get status(): TenantStatus {
    return this.props.status;
  }

  get isActive(): boolean {
    return this.props.status === 'active';
  }

  /** Tenant suspenso não autentica ninguém, nem por token já emitido. */
  assertActive(): void {
    if (!this.isActive) {
      throw new TenantNotActiveError();
    }
  }
}

export interface Membership {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly status: MembershipStatus;
}

export interface Entitlement {
  readonly moduleId: string;
  readonly status: EntitlementStatus;
  readonly expiresAt: Date | null;
}

/** Contratação vale enquanto ativa e dentro da vigência. */
export function entitlementIsValid(
  entitlement: Entitlement,
  agora: Date = new Date(),
): boolean {
  if (entitlement.status !== 'active') return false;
  return entitlement.expiresAt === null || entitlement.expiresAt > agora;
}
