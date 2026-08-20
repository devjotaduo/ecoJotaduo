declare const marca: unique symbol;

/**
 * Identificadores opacos: `TenantId` e `UserId` são strings em runtime, mas o
 * compilador impede trocar um pelo outro (ou passar uma string qualquer).
 * É a primeira barreira contra consultar o tenant errado.
 */
type Marcado<T, M extends string> = T & { readonly [marca]: M };

export type TenantId = Marcado<string, 'TenantId'>;
export type UserId = Marcado<string, 'UserId'>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidIdError extends Error {
  constructor(tipo: string, valor: string) {
    super(`${tipo} inválido: esperado UUID, recebido "${valor}"`);
    this.name = 'InvalidIdError';
  }
}

function converter<T extends string>(tipo: string, valor: string): T {
  if (!UUID.test(valor)) {
    throw new InvalidIdError(tipo, valor);
  }
  return valor as T;
}

export function toTenantId(valor: string): TenantId {
  return converter<TenantId>('TenantId', valor);
}

export function toUserId(valor: string): UserId {
  return converter<UserId>('UserId', valor);
}

export function isUuid(valor: string): boolean {
  return UUID.test(valor);
}
