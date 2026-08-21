import type { Contract } from '../../domain/contract';

/**
 * Conversão de domínio para JSON. Fica em um só lugar porque REST e MCP
 * devolvem exatamente a mesma forma.
 */
export function contratoJson(contrato: Contract) {
  return {
    id: contrato.id,
    number: contrato.number,
    customerId: contrato.customerId,
    proposalId: contrato.proposalId,
    title: contrato.title,
    /** Situação de leitura: `expired` é derivado da vigência, não guardado. */
    status: contrato.situacao(),
    storedStatus: contrato.status,
    inForce: contrato.emVigor(),
    currency: contrato.currency,
    valueCents: contrato.valueCents,
    startsOn: contrato.startsOn.toISOString(),
    endsOn: contrato.endsOn.toISOString(),
    notes: contrato.notes,
    createdAt: contrato.createdAt.toISOString(),
    updatedAt: contrato.updatedAt.toISOString(),
    activatedAt: contrato.activatedAt?.toISOString() ?? null,
    closedAt: contrato.closedAt?.toISOString() ?? null,
    closeReason: contrato.closeReason,
  };
}
