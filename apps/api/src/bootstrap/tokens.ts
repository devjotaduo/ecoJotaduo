/**
 * Tokens de injeção do composition root.
 *
 * A API monta tudo com `useFactory` + `inject` explícito (em vez de injeção
 * por tipo). Isso mantém a composição legível, evita depender de metadados de
 * decorator em runtime e faz os módulos serem plugados, não descobertos.
 */
export const ENV = Symbol('ENV');
export const PLATFORM_CORE = Symbol('PLATFORM_CORE');
export const DATABASE = Symbol('DATABASE');
export const AUDIT_LOGGER = Symbol('AUDIT_LOGGER');
export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');
export const MODULE_CATALOG = Symbol('MODULE_CATALOG');

export const IDENTITY_API = Symbol('IDENTITY_API');
export const PERSONAL_TOKENS_USE_CASE = Symbol('PERSONAL_TOKENS_USE_CASE');
export const TENANCY_API = Symbol('TENANCY_API');

export const SIGN_IN_USE_CASE = Symbol('SIGN_IN_USE_CASE');
export const REFRESH_SESSION_USE_CASE = Symbol('REFRESH_SESSION_USE_CASE');
export const ISSUE_SERVICE_TOKEN_USE_CASE = Symbol(
  'ISSUE_SERVICE_TOKEN_USE_CASE',
);
export const MANAGE_ENTITLEMENTS_USE_CASE = Symbol(
  'MANAGE_ENTITLEMENTS_USE_CASE',
);
