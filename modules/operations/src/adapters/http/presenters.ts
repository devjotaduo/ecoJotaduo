import type { Rental } from '../../domain/rental';

/**
 * Conversão de domínio para JSON. Fica em um só lugar porque REST e MCP
 * devolvem exatamente a mesma forma.
 */
export function locacaoJson(locacao: Rental) {
  return {
    id: locacao.id,
    number: locacao.number,
    contractId: locacao.contractId,
    customerId: locacao.customerId,
    assetId: locacao.assetId,
    assetCode: locacao.assetCode,
    holdId: locacao.holdId,
    /** Situação de leitura: `overdue` é derivado do prazo, não guardado. */
    status: locacao.situacao(),
    storedStatus: locacao.status,
    /** Zero quando está no prazo. É o que a cobrança extra usa. */
    overdueDays: locacao.diasDeAtraso(),
    startsAt: locacao.startsAt.toISOString(),
    endsAt: locacao.endsAt.toISOString(),
    notes: locacao.notes,
    createdAt: locacao.createdAt.toISOString(),
    updatedAt: locacao.updatedAt.toISOString(),
    startedAt: locacao.startedAt?.toISOString() ?? null,
    finishedAt: locacao.finishedAt?.toISOString() ?? null,
    canceledAt: locacao.canceledAt?.toISOString() ?? null,
    closeReason: locacao.closeReason,
  };
}
