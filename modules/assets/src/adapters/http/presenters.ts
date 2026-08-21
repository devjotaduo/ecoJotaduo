import type {
  AtivoComSituacao,
  Disponibilidade,
} from '../../application/assets.use-cases';
import type { AssetHold } from '../../domain/hold';

/**
 * Conversão de domínio para JSON. Fica em um só lugar porque REST e MCP
 * devolvem exatamente a mesma forma.
 */

export function bloqueioJson(bloqueio: AssetHold) {
  return {
    id: bloqueio.id,
    assetId: bloqueio.assetId,
    reason: bloqueio.reason,
    startsAt: bloqueio.startsAt.toISOString(),
    endsAt: bloqueio.endsAt.toISOString(),
    releasedAt: bloqueio.releasedAt?.toISOString() ?? null,
    /** Fim que de fato vale: a liberação antecipa, e é isso que conta. */
    effectiveEndsAt: bloqueio.periodoEfetivo.fim.toISOString(),
    open: bloqueio.aberto(),
    notes: bloqueio.notes,
    createdAt: bloqueio.createdAt.toISOString(),
  };
}

export function ativoJson(item: AtivoComSituacao) {
  const { asset } = item;
  return {
    id: asset.id,
    code: asset.code,
    name: asset.name,
    category: asset.category,
    serialNumber: asset.serialNumber,
    acquiredOn: asset.acquiredOn?.toISOString() ?? null,
    /** Estado GUARDADO: só `active` ou `retired`. */
    status: asset.status,
    /** Situação de leitura, derivada dos bloqueios — nunca uma coluna. */
    availability: item.availability,
    currentHold: item.currentHold ? bloqueioJson(item.currentHold) : null,
    notes: asset.notes,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    retiredAt: asset.retiredAt?.toISOString() ?? null,
    retireReason: asset.retireReason,
  };
}

export function disponibilidadeJson(resultado: Disponibilidade) {
  return {
    assetId: resultado.assetId,
    code: resultado.code,
    available: resultado.available,
    conflicts: resultado.conflicts.map(bloqueioJson),
  };
}
