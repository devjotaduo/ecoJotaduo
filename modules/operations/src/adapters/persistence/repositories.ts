import type { Database } from '@ecojotaduo/database';
import { withTenant } from '@ecojotaduo/database';
import type { TenantId } from '@ecojotaduo/tenant-context';
import { and, count, desc, eq, lte, sql } from 'drizzle-orm';

import { Rental, type RentalStatus } from '../../domain/rental';
import type {
  FiltroDeLocacoes,
  Paginado,
  RentalRepository,
} from '../../ports/repositories';

import { rentalNumbers, rentals } from './schema';

const escopo = (tenantId: string) => ({ tenantId: tenantId as TenantId });

type LinhaDeLocacao = typeof rentals.$inferSelect;

export class DrizzleRentalRepository implements RentalRepository {
  constructor(private readonly db: Database) {}

  async save(tenantId: string, locacao: Rental): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .insert(rentals)
        .values({
          id: locacao.id,
          tenantId,
          number: locacao.number,
          contractId: locacao.contractId,
          customerId: locacao.customerId,
          assetId: locacao.assetId,
          assetCode: locacao.assetCode,
          holdId: locacao.holdId,
          status: locacao.status,
          startsAt: locacao.startsAt,
          endsAt: locacao.endsAt,
          notes: locacao.notes,
          createdAt: locacao.createdAt,
          updatedAt: locacao.updatedAt,
          startedAt: locacao.startedAt,
          finishedAt: locacao.finishedAt,
          canceledAt: locacao.canceledAt,
          closeReason: locacao.closeReason,
        })
        .onConflictDoUpdate({
          target: rentals.id,
          // O combinado (contrato, equipamento, período) não é reescrito: só
          // o andamento muda.
          set: {
            status: locacao.status,
            notes: locacao.notes,
            updatedAt: locacao.updatedAt,
            startedAt: locacao.startedAt,
            finishedAt: locacao.finishedAt,
            canceledAt: locacao.canceledAt,
            closeReason: locacao.closeReason,
          },
        });
    });
  }

  async findById(tenantId: string, rentalId: string): Promise<Rental | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(rentals)
        .where(and(eq(rentals.tenantId, tenantId), eq(rentals.id, rentalId)))
        .limit(1);
      return linha ? paraDominio(linha) : null;
    });
  }

  async search(
    tenantId: string,
    filtro: FiltroDeLocacoes,
  ): Promise<Paginado<Rental>> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const condicoes = [eq(rentals.tenantId, tenantId)];
      if (filtro.contractId) {
        condicoes.push(eq(rentals.contractId, filtro.contractId));
      }
      if (filtro.customerId) {
        condicoes.push(eq(rentals.customerId, filtro.customerId));
      }
      if (filtro.assetId) {
        condicoes.push(eq(rentals.assetId, filtro.assetId));
      }
      if (filtro.status) {
        condicoes.push(eq(rentals.status, filtro.status));
      }
      // "Atrasada" é derivado, e mesmo assim filtra no BANCO: a condição é a
      // mesma que o domínio aplica (em andamento com prazo vencido). Filtrado
      // em memória depois de paginar, o total mentiria.
      if (filtro.atrasadas) {
        condicoes.push(eq(rentals.status, 'active'));
        condicoes.push(lte(rentals.endsAt, new Date()));
      }
      const onde = and(...condicoes);

      const [totalizador] = await tx
        .select({ total: count() })
        .from(rentals)
        .where(onde);

      const linhas = await tx
        .select()
        .from(rentals)
        .where(onde)
        .orderBy(desc(rentals.startsAt))
        .limit(filtro.limit)
        .offset(filtro.offset);

      return { items: linhas.map(paraDominio), total: totalizador?.total ?? 0 };
    });
  }

  /**
   * Incremento atômico, mesmo padrão do Comercial e de Contratos:
   * `on conflict do update ... returning` trava a linha da empresa e devolve o
   * valor já incrementado. `max(number) + 1` teria corrida.
   */
  async reservarNumero(tenantId: string): Promise<number> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .insert(rentalNumbers)
        .values({ tenantId, lastNumber: 1 })
        .onConflictDoUpdate({
          target: rentalNumbers.tenantId,
          set: { lastNumber: sql`${rentalNumbers.lastNumber} + 1` },
        })
        .returning({ numero: rentalNumbers.lastNumber });

      if (!linha) {
        throw new Error('Não foi possível reservar o número da locação.');
      }
      return linha.numero;
    });
  }
}

function paraDominio(linha: LinhaDeLocacao): Rental {
  return Rental.restore({
    id: linha.id,
    tenantId: linha.tenantId,
    number: linha.number,
    contractId: linha.contractId,
    customerId: linha.customerId,
    assetId: linha.assetId,
    assetCode: linha.assetCode,
    holdId: linha.holdId,
    status: linha.status as RentalStatus,
    startsAt: linha.startsAt,
    endsAt: linha.endsAt,
    notes: linha.notes,
    createdAt: linha.createdAt,
    updatedAt: linha.updatedAt,
    startedAt: linha.startedAt,
    finishedAt: linha.finishedAt,
    canceledAt: linha.canceledAt,
    closeReason: linha.closeReason,
  });
}
