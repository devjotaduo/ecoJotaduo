/**
 * Superfície pública do módulo Contratos.
 *
 * É o ÚNICO ponto de entrada para outros módulos (hoje, Operações). Ninguém de
 * fora importa `src/**` nem toca nas tabelas `contracts_*`.
 */

export interface ContractSummary {
  readonly contractId: string;
  readonly number: number;
  readonly customerId: string;
  readonly title: string;
  readonly currency: string;
  readonly valueCents: number;
  /** Situação de LEITURA: inclui `expired`, derivado de `endsOn`. */
  readonly status: string;
  /** Em vigor AGORA: ativo, começado e dentro do prazo. */
  readonly inForce: boolean;
  readonly startsOn: Date;
  readonly endsOn: Date;
}

export interface ContractsPublicApi {
  /**
   * Devolve `null` quando o contrato não existe nesta empresa — não lança.
   * Quem chama decide se ausência é erro no contexto dele.
   */
  findContract(
    tenantId: string,
    contractId: string,
  ): Promise<ContractSummary | null>;
}

export const CONTRACTS_PUBLIC_API = Symbol.for(
  'ecojotaduo.contracts.publicApi',
);
