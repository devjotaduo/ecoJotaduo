import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';
import type { EventPublisher } from '@ecojotaduo/events';
import type { UnitOfWork } from '@ecojotaduo/platform-kernel';

import {
  Asset,
  disponibilidade,
  type AssetAvailability,
} from '../domain/asset';
import {
  AssetHeldError,
  AssetInUseError,
  AssetNotFoundError,
  DuplicateAssetCodeError,
  HoldNotFoundError,
} from '../domain/errors';
import { AssetHold, type HoldReason } from '../domain/hold';
import { Periodo } from '../domain/periodo';
import type {
  AssetHoldRepository,
  AssetRepository,
  FiltroDeAtivos,
  Paginado,
} from '../ports/repositories';

/**
 * Casos de uso de Ativos.
 *
 * A regra que define o módulo: o ativo NÃO tem uma coluna "disponível". A
 * disponibilidade é sempre calculada a partir dos bloqueios que existem sobre
 * ele no instante consultado. Por isso reservar e liberar são operações sobre
 * bloqueios, e não campos que alguém edita.
 */

export interface AtivoComSituacao {
  readonly asset: Asset;
  readonly availability: AssetAvailability;
  /** O bloqueio que segura o ativo agora, quando existe. */
  readonly currentHold: AssetHold | null;
}

export class RegisterAssetUseCase {
  constructor(
    private readonly ativos: AssetRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    code: string;
    name: string;
    category: string;
    serialNumber?: string | null;
    acquiredOn?: Date | null;
    notes?: string | null;
  }): Promise<Asset> {
    const code = entrada.code.trim();
    // Verificação aqui para a mensagem ser útil; a unicidade de verdade é a
    // restrição do banco, que também vale sob criação concorrente.
    if (await this.ativos.findByCode(entrada.tenantId, code)) {
      throw new DuplicateAssetCodeError(code);
    }

    const ativo = Asset.register({
      id: randomUUID(),
      tenantId: entrada.tenantId,
      code,
      name: entrada.name,
      category: entrada.category,
      serialNumber: entrada.serialNumber,
      acquiredOn: entrada.acquiredOn,
      notes: entrada.notes,
    });

    await this.uow.executar(entrada.tenantId, async () => {
      await this.ativos.save(entrada.tenantId, ativo);
      await this.eventos.publish({
        type: 'assets.asset.registered.v1',
        resourceType: 'asset',
        resourceId: ativo.id,
        payload: {
          code: ativo.code,
          name: ativo.name,
          category: ativo.category,
        },
      });
      await this.audit.record({
        action: 'assets.asset.registered',
        result: 'success',
        resourceType: 'asset',
        resourceId: ativo.id,
        metadata: { code: ativo.code, category: ativo.category },
      });
    });

    return ativo;
  }
}

export class UpdateAssetUseCase {
  constructor(
    private readonly ativos: AssetRepository,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    assetId: string;
    name?: string;
    category?: string;
    serialNumber?: string | null;
    acquiredOn?: Date | null;
    notes?: string | null;
  }): Promise<Asset> {
    const { tenantId, assetId, ...mudancas } = entrada;
    const ativo = await exigirAtivo(this.ativos, tenantId, assetId);

    ativo.update(mudancas);

    await this.uow.executar(tenantId, async () => {
      await this.ativos.save(tenantId, ativo);
      await this.audit.record({
        action: 'assets.asset.updated',
        result: 'success',
        resourceType: 'asset',
        resourceId: ativo.id,
        metadata: { code: ativo.code },
      });
    });

    return ativo;
  }
}

export class GetAssetUseCase {
  constructor(
    private readonly ativos: AssetRepository,
    private readonly bloqueios: AssetHoldRepository,
  ) {}

  async execute(entrada: {
    tenantId: string;
    assetId: string;
    historicoLimite?: number;
  }): Promise<AtivoComSituacao & { history: AssetHold[] }> {
    const ativo = await exigirAtivo(
      this.ativos,
      entrada.tenantId,
      entrada.assetId,
    );
    const agora = new Date();
    const history = await this.bloqueios.listByAsset(
      entrada.tenantId,
      entrada.assetId,
      entrada.historicoLimite ?? 20,
    );
    const currentHold = history.find((bloqueio) => bloqueio.vigenteEm(agora));

    return {
      asset: ativo,
      availability: disponibilidade(ativo, currentHold ?? null),
      currentHold: currentHold ?? null,
      history,
    };
  }
}

export class SearchAssetsUseCase {
  constructor(
    private readonly ativos: AssetRepository,
    private readonly bloqueios: AssetHoldRepository,
  ) {}

  async execute(
    entrada: { tenantId: string } & FiltroDeAtivos,
  ): Promise<Paginado<AtivoComSituacao>> {
    const { tenantId, ...filtro } = entrada;
    const instante = filtro.em ?? new Date();
    const pagina = await this.ativos.search(tenantId, {
      ...filtro,
      em: instante,
    });

    // Uma consulta para a página inteira: a situação de cada linha não pode
    // custar uma ida ao banco por linha.
    const vigentes = await this.bloqueios.findActiveForAssets(
      tenantId,
      pagina.items.map((ativo) => ativo.id),
      instante,
    );
    const porAtivo = new Map(
      vigentes.map((bloqueio) => [bloqueio.assetId, bloqueio]),
    );

    return {
      items: pagina.items.map((ativo) => {
        const currentHold = porAtivo.get(ativo.id) ?? null;
        return {
          asset: ativo,
          availability: disponibilidade(ativo, currentHold),
          currentHold,
        };
      }),
      total: pagina.total,
    };
  }
}

export class HoldAssetUseCase {
  constructor(
    private readonly ativos: AssetRepository,
    private readonly bloqueios: AssetHoldRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    assetId: string;
    reason: HoldReason;
    startsAt: Date;
    endsAt: Date;
    notes?: string | null;
  }): Promise<AssetHold> {
    const ativo = await exigirAtivo(
      this.ativos,
      entrada.tenantId,
      entrada.assetId,
    );
    ativo.exigirEmOperacao();

    const periodo = Periodo.de(entrada.startsAt, entrada.endsAt);
    const conflitos = await this.bloqueios.findOverlapping(
      entrada.tenantId,
      entrada.assetId,
      periodo,
    );
    // Dois compromissos sobre o mesmo equipamento no mesmo intervalo é o erro
    // que o cliente descobre no dia da entrega. A restrição de exclusão do
    // banco é a rede de baixo para duas reservas simultâneas.
    if (conflitos[0]) {
      throw new AssetHeldError(ativo.code, conflitos[0].periodoEfetivo.fim);
    }

    const bloqueio = AssetHold.abrir({
      id: randomUUID(),
      tenantId: entrada.tenantId,
      assetId: entrada.assetId,
      reason: entrada.reason,
      periodo,
      notes: entrada.notes,
    });

    await this.uow.executar(entrada.tenantId, async () => {
      await this.bloqueios.save(entrada.tenantId, bloqueio);
      await this.eventos.publish({
        type: 'assets.asset.unavailable.v1',
        resourceType: 'asset',
        resourceId: ativo.id,
        payload: {
          holdId: bloqueio.id,
          code: ativo.code,
          reason: bloqueio.reason,
          startsAt: bloqueio.startsAt.toISOString(),
          endsAt: bloqueio.endsAt.toISOString(),
        },
      });
      await this.audit.record({
        action: 'assets.asset.held',
        result: 'success',
        resourceType: 'asset',
        resourceId: ativo.id,
        metadata: {
          holdId: bloqueio.id,
          code: ativo.code,
          reason: bloqueio.reason,
          startsAt: bloqueio.startsAt.toISOString(),
          endsAt: bloqueio.endsAt.toISOString(),
        },
      });
    });

    return bloqueio;
  }
}

export class ReleaseHoldUseCase {
  constructor(
    private readonly bloqueios: AssetHoldRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    holdId: string;
  }): Promise<AssetHold> {
    const bloqueio = await this.bloqueios.findById(
      entrada.tenantId,
      entrada.holdId,
    );
    if (!bloqueio) {
      throw new HoldNotFoundError(entrada.holdId);
    }

    bloqueio.release();

    await this.uow.executar(entrada.tenantId, async () => {
      await this.bloqueios.save(entrada.tenantId, bloqueio);
      await this.eventos.publish({
        type: 'assets.asset.available.v1',
        resourceType: 'asset',
        resourceId: bloqueio.assetId,
        payload: { holdId: bloqueio.id, reason: bloqueio.reason },
      });
      await this.audit.record({
        action: 'assets.asset.released',
        result: 'success',
        resourceType: 'asset',
        resourceId: bloqueio.assetId,
        metadata: { holdId: bloqueio.id, reason: bloqueio.reason },
      });
    });

    return bloqueio;
  }
}

export class RetireAssetUseCase {
  constructor(
    private readonly ativos: AssetRepository,
    private readonly bloqueios: AssetHoldRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    assetId: string;
    reason?: string | null;
  }): Promise<Asset> {
    const ativo = await exigirAtivo(
      this.ativos,
      entrada.tenantId,
      entrada.assetId,
    );

    const agora = new Date();
    const vigentes = await this.bloqueios.findActiveForAssets(
      entrada.tenantId,
      [ativo.id],
      agora,
    );
    if (vigentes.length > 0) {
      throw new AssetInUseError(ativo.code);
    }

    ativo.retire(entrada.reason ?? null, agora);

    await this.uow.executar(entrada.tenantId, async () => {
      await this.ativos.save(entrada.tenantId, ativo);
      await this.eventos.publish({
        type: 'assets.asset.retired.v1',
        resourceType: 'asset',
        resourceId: ativo.id,
        payload: { code: ativo.code, reason: ativo.retireReason },
      });
      await this.audit.record({
        action: 'assets.asset.retired',
        result: 'success',
        resourceType: 'asset',
        resourceId: ativo.id,
        metadata: { code: ativo.code, reason: ativo.retireReason },
      });
    });

    return ativo;
  }
}

/** O que Operações vai perguntar antes de prometer um equipamento. */
export interface Disponibilidade {
  readonly assetId: string;
  readonly code: string;
  readonly available: boolean;
  readonly conflicts: AssetHold[];
}

export class CheckAvailabilityUseCase {
  constructor(
    private readonly ativos: AssetRepository,
    private readonly bloqueios: AssetHoldRepository,
  ) {}

  async execute(entrada: {
    tenantId: string;
    assetId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<Disponibilidade> {
    const ativo = await exigirAtivo(
      this.ativos,
      entrada.tenantId,
      entrada.assetId,
    );
    const periodo = Periodo.de(entrada.startsAt, entrada.endsAt);

    // Ativo baixado nunca fica disponível de novo — nem em período futuro.
    if (ativo.status === 'retired') {
      return {
        assetId: ativo.id,
        code: ativo.code,
        available: false,
        conflicts: [],
      };
    }

    const conflicts = await this.bloqueios.findOverlapping(
      entrada.tenantId,
      entrada.assetId,
      periodo,
    );
    return {
      assetId: ativo.id,
      code: ativo.code,
      available: conflicts.length === 0,
      conflicts,
    };
  }
}

async function exigirAtivo(
  ativos: AssetRepository,
  tenantId: string,
  assetId: string,
): Promise<Asset> {
  const ativo = await ativos.findById(tenantId, assetId);
  if (!ativo) {
    throw new AssetNotFoundError(assetId);
  }
  return ativo;
}
