import { createHmac } from 'node:crypto';

/**
 * Assinatura das entregas: HMAC-SHA256 sobre `timestamp.corpo`.
 *
 * O timestamp entra DENTRO da assinatura, não só no cabeçalho — assinar
 * apenas o corpo deixaria a mesma entrega válida para sempre, e quem
 * capturasse uma poderia repeti-la indefinidamente. Com o timestamp assinado,
 * o receptor recusa o que estiver fora da janela e a repetição morre.
 */

export const CABECALHO_ASSINATURA = 'x-ecojotaduo-signature';
export const CABECALHO_TIMESTAMP = 'x-ecojotaduo-timestamp';

export function assinarEntrega(entrada: {
  corpo: string;
  timestamp: number;
  segredo: string;
}): string {
  return `v1=${createHmac('sha256', entrada.segredo)
    .update(`${entrada.timestamp}.${entrada.corpo}`, 'utf8')
    .digest('hex')}`;
}
