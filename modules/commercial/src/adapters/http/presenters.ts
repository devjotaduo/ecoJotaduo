import type { Proposal, ProposalItem } from '../../domain/proposal';

/**
 * Conversão de domínio para JSON. Fica em um só lugar porque REST e MCP
 * devolvem exatamente a mesma forma.
 *
 * O total NUNCA vem da entrada: é sempre recalculado do domínio na hora de
 * apresentar. Aceitar um total informado seria deixar o cliente escolher
 * quanto vai pagar.
 */

export function itemJson(item: ProposalItem, posicao: number) {
  return {
    id: item.id,
    position: posicao,
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unitPrice.cents,
    discountCents: item.discount.cents,
    totalCents: item.total.cents,
  };
}

export function propostaJson(proposta: Proposal, customerName?: string | null) {
  return {
    id: proposta.id,
    number: proposta.number,
    customerId: proposta.customerId,
    customerName: customerName ?? null,
    title: proposta.title,
    /** Situação de leitura: `expired` é derivado da validade, não guardado. */
    status: proposta.situacao(),
    storedStatus: proposta.status,
    currency: proposta.currency,
    totalCents: proposta.total.cents,
    notes: proposta.notes,
    validUntil: proposta.validUntil.toISOString(),
    items: proposta.items.map(itemJson),
    createdAt: proposta.createdAt.toISOString(),
    updatedAt: proposta.updatedAt.toISOString(),
    sentAt: proposta.sentAt?.toISOString() ?? null,
    decidedAt: proposta.decidedAt?.toISOString() ?? null,
  };
}
