import type { Database } from '@ecojotaduo/database';
import { withTenant } from '@ecojotaduo/database';
import type { TenantId } from '@ecojotaduo/tenant-context';
import { and, count, desc, eq, ilike, sql } from 'drizzle-orm';

import { Contract, type ContractStatus } from '../../domain/contract';
import type {
  ContractRepository,
  FiltroDeContratos,
  Paginado,
} from '../../ports/repositories';

import { contractNumbers, contracts } from './schema';

const escopo = (tenantId: string) => ({ tenantId: tenantId as TenantId });

type LinhaDeContrato = typeof contracts.$inferSelect;

export class DrizzleContractRepository implements ContractRepository {
  constructor(private readonly db: Database) {}

  async save(tenantId: string, contrato: Contract): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .insert(contracts)
        .values({
          id: contrato.id,
          tenantId,
          customerId: contrato.customerId,
          proposalId: contrato.proposalId,
          number: contrato.number,
          status: contrato.status,
          title: contrato.title,
          currency: contrato.currency,
          valueCents: contrato.valueCents,
          startsOn: contrato.startsOn,
          endsOn: contrato.endsOn,
          notes: contrato.notes,
          createdAt: contrato.createdAt,
          updatedAt: contrato.updatedAt,
          activatedAt: contrato.activatedAt,
          closedAt: contrato.closedAt,
          closeReason: contrato.closeReason,
        })
        .onConflictDoUpdate({
          target: contracts.id,
          set: {
            status: contrato.status,
            notes: contrato.notes,
            updatedAt: contrato.updatedAt,
            activatedAt: contrato.activatedAt,
            closedAt: contrato.closedAt,
            closeReason: contrato.closeReason,
          },
        });
    });
  }

  async findById(
    tenantId: string,
    contractId: string,
  ): Promise<Contract | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(contracts)
        .where(
          and(eq(contracts.tenantId, tenantId), eq(contracts.id, contractId)),
        )
        .limit(1);
      return linha ? paraDominio(linha) : null;
    });
  }

  async findByProposal(
    tenantId: string,
    proposalId: string,
  ): Promise<Contract | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(contracts)
        .where(
          and(
            eq(contracts.tenantId, tenantId),
            eq(contracts.proposalId, proposalId),
          ),
        )
        .limit(1);
      return linha ? paraDominio(linha) : null;
    });
  }

  async search(
    tenantId: string,
    filtro: FiltroDeContratos,
  ): Promise<Paginado<Contract>> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const condicoes = [eq(contracts.tenantId, tenantId)];
      if (filtro.customerId) {
        condicoes.push(eq(contracts.customerId, filtro.customerId));
      }
      if (filtro.status) {
        condicoes.push(eq(contracts.status, filtro.status));
      }
      if (filtro.termo) {
        condicoes.push(ilike(contracts.title, `%${filtro.termo}%`));
      }
      const onde = and(...condicoes);

      const [totalizador] = await tx
        .select({ total: count() })
        .from(contracts)
        .where(onde);

      const linhas = await tx
        .select()
        .from(contracts)
        .where(onde)
        .orderBy(desc(contracts.createdAt))
        .limit(filtro.limit)
        .offset(filtro.offset);

      return {
        items: linhas.map(paraDominio),
        total: totalizador?.total ?? 0,
      };
    });
  }

  /**
   * Incremento atômico, mesmo padrão do Comercial: `on conflict do update ...
   * returning` trava a linha da empresa e devolve o valor já incrementado.
   * Contador por módulo, e não compartilhado — tabela usada por dois módulos
   * seria o repositório global que o mapa de módulos proíbe.
   */
  async reservarNumero(tenantId: string): Promise<number> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .insert(contractNumbers)
        .values({ tenantId, lastNumber: 1 })
        .onConflictDoUpdate({
          target: contractNumbers.tenantId,
          set: { lastNumber: sql`${contractNumbers.lastNumber} + 1` },
        })
        .returning({ numero: contractNumbers.lastNumber });

      if (!linha) {
        throw new Error('Não foi possível reservar o número do contrato.');
      }
      return linha.numero;
    });
  }
}

function paraDominio(linha: LinhaDeContrato): Contract {
  return Contract.restore({
    id: linha.id,
    tenantId: linha.tenantId,
    customerId: linha.customerId,
    proposalId: linha.proposalId,
    number: linha.number,
    status: linha.status as ContractStatus,
    title: linha.title,
    currency: linha.currency,
    valueCents: linha.valueCents,
    startsOn: linha.startsOn,
    endsOn: linha.endsOn,
    notes: linha.notes,
    createdAt: linha.createdAt,
    updatedAt: linha.updatedAt,
    activatedAt: linha.activatedAt,
    closedAt: linha.closedAt,
    closeReason: linha.closeReason,
  });
}
