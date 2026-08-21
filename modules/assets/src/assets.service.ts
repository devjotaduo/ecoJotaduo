import type {
  HoldAssetUseCase,
  ReleaseHoldUseCase,
} from './application/assets.use-cases';
import type {
  AssetAvailabilityAnswer,
  AssetReservation,
  AssetsPublicApi,
  AssetSummary,
} from './contracts/public-api';
import { disponibilidade } from './domain/asset';
import { Periodo } from './domain/periodo';
import type {
  AssetHoldRepository,
  AssetRepository,
} from './ports/repositories';

/** Implementação da superfície pública de Ativos. */
export class AssetsService implements AssetsPublicApi {
  constructor(
    private readonly ativos: AssetRepository,
    private readonly bloqueios: AssetHoldRepository,
    // Reservar passa pelos CASOS DE USO, e não direto no repositório: a
    // verificação de sobreposição, a recusa de ativo baixado e a auditoria
    // ficam num lugar só, valendo igual para a borda REST, a tool MCP e o
    // módulo que chama daqui.
    private readonly bloquear: HoldAssetUseCase,
    private readonly liberar: ReleaseHoldUseCase,
  ) {}

  async findAsset(
    tenantId: string,
    assetId: string,
  ): Promise<AssetSummary | null> {
    const ativo = await this.ativos.findById(tenantId, assetId);
    if (!ativo) {
      return null;
    }
    const agora = new Date();
    const [vigente] = await this.bloqueios.findActiveForAssets(
      tenantId,
      [ativo.id],
      agora,
    );

    return {
      assetId: ativo.id,
      code: ativo.code,
      name: ativo.name,
      category: ativo.category,
      // A situação sai dos bloqueios, e não de uma coluna: quem consome
      // enxerga o equipamento ocupado como ocupado, sem depender de rotina.
      availability: disponibilidade(ativo, vigente ?? null),
    };
  }

  async checkAvailability(
    tenantId: string,
    assetId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<AssetAvailabilityAnswer | null> {
    const ativo = await this.ativos.findById(tenantId, assetId);
    if (!ativo) {
      return null;
    }
    const base = { assetId: ativo.id, code: ativo.code };

    // Ativo baixado não volta a ficar disponível, nem em período futuro.
    if (ativo.status === 'retired') {
      return { ...base, available: false, heldUntil: null };
    }

    const conflitos = await this.bloqueios.findOverlapping(
      tenantId,
      assetId,
      Periodo.de(startsAt, endsAt),
    );
    const primeiro = conflitos[0];
    return {
      ...base,
      available: conflitos.length === 0,
      heldUntil: primeiro ? primeiro.periodoEfetivo.fim : null,
    };
  }

  async reserve(
    tenantId: string,
    entrada: {
      assetId: string;
      startsAt: Date;
      endsAt: Date;
      notes?: string | null;
    },
  ): Promise<AssetReservation> {
    const bloqueio = await this.bloquear.execute({
      tenantId,
      assetId: entrada.assetId,
      // Reserva de outro módulo é sempre compromisso com alguém, nunca
      // manutenção — o motivo diz por que o equipamento está fora.
      reason: 'reserved',
      startsAt: entrada.startsAt,
      endsAt: entrada.endsAt,
      notes: entrada.notes,
    });

    return {
      holdId: bloqueio.id,
      assetId: bloqueio.assetId,
      startsAt: bloqueio.startsAt,
      endsAt: bloqueio.endsAt,
    };
  }

  async releaseReservation(tenantId: string, holdId: string): Promise<void> {
    await this.liberar.execute({ tenantId, holdId });
  }
}
