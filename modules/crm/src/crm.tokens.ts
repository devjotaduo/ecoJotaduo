/**
 * Tokens de injeção do módulo CRM.
 *
 * O módulo declara os tokens; o composition root (apps/api) fornece as
 * implementações. Injeção sempre explícita — ver CLAUDE.md.
 */
export const CRM_CREATE_CUSTOMER = Symbol('CRM_CREATE_CUSTOMER');
export const CRM_UPDATE_CUSTOMER = Symbol('CRM_UPDATE_CUSTOMER');
export const CRM_GET_CUSTOMER = Symbol('CRM_GET_CUSTOMER');
export const CRM_SEARCH_CUSTOMERS = Symbol('CRM_SEARCH_CUSTOMERS');
export const CRM_ADD_NOTE = Symbol('CRM_ADD_NOTE');
export const CRM_LIST_NOTES = Symbol('CRM_LIST_NOTES');
export const CRM_SCHEDULE_APPOINTMENT = Symbol('CRM_SCHEDULE_APPOINTMENT');
export const CRM_CLOSE_APPOINTMENT = Symbol('CRM_CLOSE_APPOINTMENT');
export const CRM_LIST_AGENDA = Symbol('CRM_LIST_AGENDA');
