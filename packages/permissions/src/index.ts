/**
 * Motor de autorização. É puro (sem I/O) e é o ÚNICO lugar onde a decisão de
 * acesso é tomada — REST, MCP, jobs e webhooks convergem aqui.
 */

/** Formato `modulo.recurso.acao`, ex.: `crm.customer.read`. */
export type Permission = string;

/** Módulo sempre disponível: não exige contratação. */
export const PLATFORM_MODULE = 'platform';

export interface PermissionDefinition {
  readonly key: Permission;
  readonly description: string;
}

export interface AccessGrant {
  /** Permissões vindas dos papéis (RBAC); aceita curingas `*` e `modulo.*`. */
  readonly permissions: readonly string[];
  /** Escopos declarados no token (API/MCP); limitam o que o RBAC concede. */
  readonly scopes: readonly string[];
  /** Módulos contratados pelo tenant. */
  readonly entitlements: readonly string[];
}

export type DenialReason = 'entitlement' | 'permission' | 'scope';

export type AccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: DenialReason;
      readonly required: Permission;
      readonly moduleId: string;
    };

export class ForbiddenError extends Error {
  constructor(
    readonly reason: DenialReason,
    readonly required: Permission,
    readonly moduleId: string,
  ) {
    super(
      reason === 'entitlement'
        ? `Módulo "${moduleId}" não está contratado por este tenant.`
        : `Permissão negada para "${required}".`,
    );
    this.name = 'ForbiddenError';
  }
}

/** Módulo a que a permissão pertence (primeiro segmento). */
export function moduleOf(permission: Permission): string {
  const separador = permission.indexOf('.');
  return separador === -1 ? permission : permission.slice(0, separador);
}

/**
 * Casa uma permissão contra um padrão. Curingas só existem como sufixo de
 * segmento (`*`, `crm.*`, `crm.customer.*`) — nunca no meio, para que
 * `crm.*` jamais alcance `crmx.algo`.
 */
export function permissionMatches(
  pattern: string,
  permission: Permission,
): boolean {
  if (pattern === '*') return true;
  if (pattern === permission) return true;
  if (!pattern.endsWith('.*')) return false;
  const prefixo = pattern.slice(0, -1);
  return permission.startsWith(prefixo) && permission.length > prefixo.length;
}

function concede(patterns: readonly string[], required: Permission): boolean {
  return patterns.some((pattern) => permissionMatches(pattern, required));
}

/**
 * Ordem da decisão: contratação do módulo → papéis (RBAC) → escopos do token.
 * O resultado efetivo é a interseção dos três.
 */
export function authorize(
  grant: AccessGrant,
  required: Permission,
): AccessDecision {
  const moduleId = moduleOf(required);

  if (moduleId !== PLATFORM_MODULE && !grant.entitlements.includes(moduleId)) {
    return { allowed: false, reason: 'entitlement', required, moduleId };
  }
  if (!concede(grant.permissions, required)) {
    return { allowed: false, reason: 'permission', required, moduleId };
  }
  if (!concede(grant.scopes, required)) {
    return { allowed: false, reason: 'scope', required, moduleId };
  }
  return { allowed: true };
}

/** Igual a `authorize`, mas lança — usado por guards e casos de uso. */
export function assertAllowed(grant: AccessGrant, required: Permission): void {
  const decisao = authorize(grant, required);
  if (!decisao.allowed) {
    throw new ForbiddenError(
      decisao.reason,
      decisao.required,
      decisao.moduleId,
    );
  }
}

/** Exige todas as permissões da lista (AND). */
export function assertAllAllowed(
  grant: AccessGrant,
  required: readonly Permission[],
): void {
  for (const permission of required) {
    assertAllowed(grant, permission);
  }
}
