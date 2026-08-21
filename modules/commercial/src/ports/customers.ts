/**
 * O que o Comercial precisa saber sobre um cliente.
 *
 * Porta própria, com as palavras deste módulo: o adaptador que liga isto ao
 * CRM vive no composition root. Assim o Comercial é testável sem o CRM, e uma
 * eventual troca de origem do cadastro não vaza para os casos de uso.
 */
export interface CustomerDirectory {
  /** `null` quando o cliente não existe NESTA empresa. */
  findName(tenantId: string, customerId: string): Promise<string | null>;
}
