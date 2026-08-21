/**
 * Tokens de injeção do módulo Contratos.
 *
 * O módulo declara os tokens; o composition root fornece as implementações.
 * Injeção sempre explícita — ver CLAUDE.md.
 */
export const CONTRACTS_CREATE = Symbol('CONTRACTS_CREATE');
export const CONTRACTS_GET = Symbol('CONTRACTS_GET');
export const CONTRACTS_SEARCH = Symbol('CONTRACTS_SEARCH');
export const CONTRACTS_ACTIVATE = Symbol('CONTRACTS_ACTIVATE');
export const CONTRACTS_CLOSE = Symbol('CONTRACTS_CLOSE');
