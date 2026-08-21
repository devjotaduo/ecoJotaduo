import type { Database } from '@ecojotaduo/database';
import { withTenant } from '@ecojotaduo/database';
import type { TenantId } from '@ecojotaduo/tenant-context';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { Asset, type AssetStatus } from '../../domain/asset';
import { AssetHold, type HoldReason } from '../../domain/hold';
import type { Periodo } from '../../domain/periodo';
import type {
  AssetHoldRepository,
  AssetRepository,
  FiltroDeAtivos,
  Paginado,
} from '../../ports/repositories';

import { assetHolds, assets } from './schema';

const escopo = (tenantId: string) => ({ tenantId: tenantId as TenantId });

type LinhaDeAtivo = typeof assets.$inferSelect;
type LinhaDeBloqueio = typeof assetHolds.$inferSelect;

/**
 * Datas vão para o SQL cru como texto ISO, e não como `Date`.
 *
 * Dentro de um template `sql` o Drizzle não sabe a que coluna o valor
 * corresponde, então entrega o objeto ao driver sem serializar — e o driver
 * rejeita. Em `eq(coluna, data)` isso não acontece porque ali o tipo é conhecido.
 */
function instanteSql(momento: Date): string {
  return momento.toISOString();
}

/**
 * O período que de fato prende o ativo, encurtado pela liberação.
 *
 * É a MESMA expressão da restrição de exclusão na migração. Se as duas
 * divergirem, a consulta diria "livre" e o `insert` seria recusado pelo banco —
 * por isso ela mora aqui, em um lugar só, e não copiada por consulta.
 */
function periodoEfetivo(prefixo: string): SQL {
  return sql.raw(
    `tstzrange(${prefixo}.starts_at, ` +
      `greatest(${prefixo}.starts_at, coalesce(${prefixo}.released_at, ${prefixo}.ends_at)), '[)')`,
  );
}

const EFETIVO = periodoEfetivo('assets_asset_holds');

export class DrizzleAssetRepository implements AssetRepository {
  constructor(private readonly db: Database) {}

  async save(tenantId: string, ativo: Asset): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .insert(assets)
        .values({
          id: ativo.id,
          tenantId,
          code: ativo.code,
          name: ativo.name,
          category: ativo.category,
          serialNumber: ativo.serialNumber,
          acquiredOn: ativo.acquiredOn,
          status: ativo.status,
          notes: ativo.notes,
          createdAt: ativo.createdAt,
          updatedAt: ativo.updatedAt,
          retiredAt: ativo.retiredAt,
          retireReason: ativo.retireReason,
        })
        .onConflictDoUpdate({
          target: assets.id,
          set: {
            name: ativo.name,
            category: ativo.category,
            serialNumber: ativo.serialNumber,
            acquiredOn: ativo.acquiredOn,
            status: ativo.status,
            notes: ativo.notes,
            updatedAt: ativo.updatedAt,
            retiredAt: ativo.retiredAt,
            retireReason: ativo.retireReason,
          },
        });
    });
  }

  async findById(tenantId: string, assetId: string): Promise<Asset | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.tenantId, tenantId), eq(assets.id, assetId)))
        .limit(1);
      return linha ? paraAtivo(linha) : null;
    });
  }

  async findByCode(tenantId: string, code: string): Promise<Asset | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.tenantId, tenantId), eq(assets.code, code)))
        .limit(1);
      return linha ? paraAtivo(linha) : null;
    });
  }

  async search(
    tenantId: string,
    filtro: FiltroDeAtivos,
  ): Promise<Paginado<Asset>> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const instante = filtro.em ?? new Date();
      const condicoes = [eq(assets.tenantId, tenantId)];

      if (filtro.category) {
        condicoes.push(eq(assets.category, filtro.category));
      }
      if (filtro.termo) {
        const termo = `%${filtro.termo}%`;
        condicoes.push(
          sql`(${assets.name} ilike ${termo} or ${assets.code} ilike ${termo})`,
        );
      }
      // A disponibilidade é filtrada no BANCO, e não depois de paginar: com o
      // filtro em memória, uma página de 20 devolveria menos de 20 linhas e o
      // total mentiria.
      if (filtro.availability === 'retired') {
        condicoes.push(eq(assets.status, 'retired'));
      } else if (filtro.availability) {
        condicoes.push(eq(assets.status, 'active'));
        const preso = temBloqueioVigente(instante);
        condicoes.push(
          filtro.availability === 'held' ? preso : sql`not ${preso}`,
        );
      }
      const onde = and(...condicoes);

      const [totalizador] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(assets)
        .where(onde);

      const linhas = await tx
        .select()
        .from(assets)
        .where(onde)
        .orderBy(asc(assets.code))
        .limit(filtro.limit)
        .offset(filtro.offset);

      return { items: linhas.map(paraAtivo), total: totalizador?.total ?? 0 };
    });
  }
}

/** `exists` correlacionado: o ativo tem bloqueio cobrindo o instante? */
function temBloqueioVigente(instante: Date): SQL {
  return sql`exists (
    select 1 from ${assetHolds}
    where ${assetHolds.tenantId} = ${assets.tenantId}
      and ${assetHolds.assetId} = ${assets.id}
      and ${EFETIVO} @> ${instanteSql(instante)}::timestamptz
  )`;
}

export class DrizzleAssetHoldRepository implements AssetHoldRepository {
  constructor(private readonly db: Database) {}

  async save(tenantId: string, bloqueio: AssetHold): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .insert(assetHolds)
        .values({
          id: bloqueio.id,
          tenantId,
          assetId: bloqueio.assetId,
          reason: bloqueio.reason,
          startsAt: bloqueio.startsAt,
          endsAt: bloqueio.endsAt,
          releasedAt: bloqueio.releasedAt,
          notes: bloqueio.notes,
          createdAt: bloqueio.createdAt,
        })
        .onConflictDoUpdate({
          target: assetHolds.id,
          // Só a liberação muda um bloqueio: o período combinado não é
          // reescrito, senão o histórico deixaria de contar o que aconteceu.
          set: { releasedAt: bloqueio.releasedAt },
        });
    });
  }

  async findById(tenantId: string, holdId: string): Promise<AssetHold | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(assetHolds)
        .where(
          and(eq(assetHolds.tenantId, tenantId), eq(assetHolds.id, holdId)),
        )
        .limit(1);
      return linha ? paraBloqueio(linha) : null;
    });
  }

  async findOverlapping(
    tenantId: string,
    assetId: string,
    periodo: Periodo,
  ): Promise<AssetHold[]> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const linhas = await tx
        .select()
        .from(assetHolds)
        .where(
          and(
            eq(assetHolds.tenantId, tenantId),
            eq(assetHolds.assetId, assetId),
            sql`${EFETIVO} && tstzrange(${instanteSql(periodo.inicio)}::timestamptz, ${instanteSql(periodo.fim)}::timestamptz, '[)')`,
          ),
        )
        .orderBy(asc(assetHolds.startsAt));
      return linhas.map(paraBloqueio);
    });
  }

  async listByAsset(
    tenantId: string,
    assetId: string,
    limite: number,
  ): Promise<AssetHold[]> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const linhas = await tx
        .select()
        .from(assetHolds)
        .where(
          and(
            eq(assetHolds.tenantId, tenantId),
            eq(assetHolds.assetId, assetId),
          ),
        )
        .orderBy(desc(assetHolds.startsAt))
        .limit(limite);
      return linhas.map(paraBloqueio);
    });
  }

  async findActiveForAssets(
    tenantId: string,
    assetIds: readonly string[],
    instante: Date,
  ): Promise<AssetHold[]> {
    if (assetIds.length === 0) {
      return [];
    }
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const linhas = await tx
        .select()
        .from(assetHolds)
        .where(
          and(
            eq(assetHolds.tenantId, tenantId),
            inArray(assetHolds.assetId, [...assetIds]),
            sql`${EFETIVO} @> ${instanteSql(instante)}::timestamptz`,
          ),
        );
      return linhas.map(paraBloqueio);
    });
  }
}

function paraAtivo(linha: LinhaDeAtivo): Asset {
  return Asset.restore({
    id: linha.id,
    tenantId: linha.tenantId,
    code: linha.code,
    name: linha.name,
    category: linha.category,
    serialNumber: linha.serialNumber,
    acquiredOn: linha.acquiredOn,
    status: linha.status as AssetStatus,
    notes: linha.notes,
    createdAt: linha.createdAt,
    updatedAt: linha.updatedAt,
    retiredAt: linha.retiredAt,
    retireReason: linha.retireReason,
  });
}

function paraBloqueio(linha: LinhaDeBloqueio): AssetHold {
  return AssetHold.restore({
    id: linha.id,
    tenantId: linha.tenantId,
    assetId: linha.assetId,
    reason: linha.reason as HoldReason,
    startsAt: linha.startsAt,
    endsAt: linha.endsAt,
    releasedAt: linha.releasedAt,
    notes: linha.notes,
    createdAt: linha.createdAt,
  });
}
