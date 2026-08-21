/**
 * Tokens de injeção do módulo Operações.
 *
 * O módulo declara os tokens; o composition root fornece as implementações.
 * Injeção sempre explícita — ver CLAUDE.md.
 */
export const OPERATIONS_SCHEDULE = Symbol('OPERATIONS_SCHEDULE');
export const OPERATIONS_START = Symbol('OPERATIONS_START');
export const OPERATIONS_FINISH = Symbol('OPERATIONS_FINISH');
export const OPERATIONS_CANCEL = Symbol('OPERATIONS_CANCEL');
export const OPERATIONS_GET = Symbol('OPERATIONS_GET');
export const OPERATIONS_SEARCH = Symbol('OPERATIONS_SEARCH');
