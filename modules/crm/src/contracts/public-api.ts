/**
 * Superfície pública do módulo CRM.
 *
 * É o ÚNICO ponto de entrada para outros módulos (hoje, commercial). Ninguém
 * de fora importa `src/**` nem toca nas tabelas `crm_*` diretamente.
 */

export interface CrmCustomerSummary {
  readonly customerId: string;
  readonly name: string;
  readonly status: string;
}

export interface CrmPublicApi {
  /**
   * Devolve `null` quando o cliente não existe NESTA empresa — não lança.
   *
   * Ausência é resposta legítima para quem só quer validar uma referência; o
   * módulo que chama decide se isso é erro no contexto dele. Lançar aqui
   * obrigaria o consumidor a capturar um erro de outro pacote por
   * `instanceof`, que é justamente a checagem em que não dá para confiar
   * atravessando pacote (ver CLAUDE.md).
   */
  findCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<CrmCustomerSummary | null>;
}

export const CRM_PUBLIC_API = Symbol.for('ecojotaduo.crm.publicApi');
