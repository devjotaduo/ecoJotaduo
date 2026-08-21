/**
 * O que Operações precisa saber sobre um contrato.
 *
 * Porta própria, com as palavras deste módulo. Quem liga isto ao módulo
 * Contratos é o composition root — assim Operações é testável sozinho, e a
 * regra "só sob contrato em vigor" fica AQUI, onde ela é do negócio de locação.
 */
export interface ContratoDeLocacao {
  readonly contractId: string;
  readonly number: number;
  readonly customerId: string;
  readonly title: string;
  /** Situação de LEITURA do contrato (inclui `expired`). */
  readonly status: string;
  readonly startsOn: Date;
  readonly endsOn: Date;
}

export interface ContractDirectory {
  /** `null` quando o contrato não existe NESTA empresa. */
  find(tenantId: string, contractId: string): Promise<ContratoDeLocacao | null>;
}
