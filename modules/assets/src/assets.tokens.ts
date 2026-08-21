/**
 * Tokens de injeção do módulo Ativos.
 *
 * O módulo declara os tokens; o composition root fornece as implementações.
 * Injeção sempre explícita — ver CLAUDE.md.
 */
export const ASSETS_REGISTER = Symbol('ASSETS_REGISTER');
export const ASSETS_UPDATE = Symbol('ASSETS_UPDATE');
export const ASSETS_GET = Symbol('ASSETS_GET');
export const ASSETS_SEARCH = Symbol('ASSETS_SEARCH');
export const ASSETS_HOLD = Symbol('ASSETS_HOLD');
export const ASSETS_RELEASE = Symbol('ASSETS_RELEASE');
export const ASSETS_RETIRE = Symbol('ASSETS_RETIRE');
export const ASSETS_AVAILABILITY = Symbol('ASSETS_AVAILABILITY');
