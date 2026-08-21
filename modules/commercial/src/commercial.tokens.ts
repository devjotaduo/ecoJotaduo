/**
 * Tokens de injeção do módulo Comercial.
 *
 * O módulo declara os tokens; o composition root fornece as implementações.
 * Injeção sempre explícita — ver CLAUDE.md.
 */
export const COMMERCIAL_CREATE_PROPOSAL = Symbol('COMMERCIAL_CREATE_PROPOSAL');
export const COMMERCIAL_UPDATE_PROPOSAL = Symbol('COMMERCIAL_UPDATE_PROPOSAL');
export const COMMERCIAL_GET_PROPOSAL = Symbol('COMMERCIAL_GET_PROPOSAL');
export const COMMERCIAL_SEARCH_PROPOSALS = Symbol(
  'COMMERCIAL_SEARCH_PROPOSALS',
);
export const COMMERCIAL_SEND_PROPOSAL = Symbol('COMMERCIAL_SEND_PROPOSAL');
export const COMMERCIAL_DECIDE_PROPOSAL = Symbol('COMMERCIAL_DECIDE_PROPOSAL');
