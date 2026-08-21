/**
 * Tokens de injeção do módulo de plugins.
 *
 * O módulo declara os tokens; o composition root fornece as implementações.
 * Injeção sempre explícita — ver CLAUDE.md.
 */
export const PLUGINS_INSTALL = Symbol('PLUGINS_INSTALL');
export const PLUGINS_CONFIGURE = Symbol('PLUGINS_CONFIGURE');
export const PLUGINS_CHANGE_STATUS = Symbol('PLUGINS_CHANGE_STATUS');
export const PLUGINS_LIST = Symbol('PLUGINS_LIST');
export const PLUGINS_RESOLVE_RUNTIME = Symbol('PLUGINS_RESOLVE_RUNTIME');
