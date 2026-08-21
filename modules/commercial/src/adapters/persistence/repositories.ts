import type { Database } from '@ecojotaduo/database';
import { withTenant } from '@ecojotaduo/database';
import type { TenantId } from '@ecojotaduo/tenant-context';
import { and, count, desc, eq, ilike, inArray, sql } from 'drizzle-orm';

import { Proposal, type ProposalStatus } from '../../domain/proposal';
import type {
  FiltroDePropostas,
  Paginado,
  ProposalRepository,
} from '../../ports/repositories';

import { proposalItems, proposalNumbers, proposals } from './schema';

const escopo = (tenantId: string) => ({ tenantId: tenantId as TenantId });

type LinhaDeProposta = typeof proposals.$inferSelect;
type LinhaDeItem = typeof proposalItems.$inferSelect;

export class DrizzleProposalRepository implements ProposalRepository {
  constructor(private readonly db: Database) {}

  /**
   * Cabeçalho e itens gravam na MESMA transação (`withTenant` abre uma).
   * Metade de uma proposta salva é pior do que nenhuma: o total exibido
   * deixaria de bater com os itens.
   */
  async save(tenantId: string, proposta: Proposal): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .insert(proposals)
        .values({
          id: proposta.id,
          tenantId,
          customerId: proposta.customerId,
          number: proposta.number,
          status: proposta.status,
          currency: proposta.currency,
          title: proposta.title,
          notes: proposta.notes,
          validUntil: proposta.validUntil,
          createdAt: proposta.createdAt,
          updatedAt: proposta.updatedAt,
          sentAt: proposta.sentAt,
          decidedAt: proposta.decidedAt,
        })
        .onConflictDoUpdate({
          target: proposals.id,
          set: {
            status: proposta.status,
            title: proposta.title,
            notes: proposta.notes,
            validUntil: proposta.validUntil,
            updatedAt: proposta.updatedAt,
            sentAt: proposta.sentAt,
            decidedAt: proposta.decidedAt,
          },
        });

      // Itens são substituídos em bloco: o agregado é dono da lista inteira,
      // e reconciliar item a item traria ordem e duplicidade para o adaptador.
      await tx
        .delete(proposalItems)
        .where(
          and(
            eq(proposalItems.tenantId, tenantId),
            eq(proposalItems.proposalId, proposta.id),
          ),
        );

      const itens = proposta.items;
      if (itens.length > 0) {
        await tx.insert(proposalItems).values(
          itens.map((item, posicao) => ({
            id: item.id,
            tenantId,
            proposalId: proposta.id,
            position: posicao,
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unitPrice.cents,
            discountCents: item.discount.cents,
          })),
        );
      }
    });
  }

  async findById(
    tenantId: string,
    proposalId: string,
  ): Promise<Proposal | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [cabecalho] = await tx
        .select()
        .from(proposals)
        .where(
          and(eq(proposals.tenantId, tenantId), eq(proposals.id, proposalId)),
        )
        .limit(1);
      if (!cabecalho) {
        return null;
      }

      const itens = await tx
        .select()
        .from(proposalItems)
        .where(
          and(
            eq(proposalItems.tenantId, tenantId),
            eq(proposalItems.proposalId, proposalId),
          ),
        )
        .orderBy(proposalItems.position);

      return paraDominio(cabecalho, itens);
    });
  }

  async search(
    tenantId: string,
    filtro: FiltroDePropostas,
  ): Promise<Paginado<Proposal>> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const condicoes = [eq(proposals.tenantId, tenantId)];
      if (filtro.customerId) {
        condicoes.push(eq(proposals.customerId, filtro.customerId));
      }
      if (filtro.status) {
        condicoes.push(eq(proposals.status, filtro.status));
      }
      if (filtro.termo) {
        condicoes.push(ilike(proposals.title, `%${filtro.termo}%`));
      }
      const onde = and(...condicoes);

      const [totalizador] = await tx
        .select({ total: count() })
        .from(proposals)
        .where(onde);

      const cabecalhos = await tx
        .select()
        .from(proposals)
        .where(onde)
        .orderBy(desc(proposals.createdAt))
        .limit(filtro.limit)
        .offset(filtro.offset);

      if (cabecalhos.length === 0) {
        return { items: [], total: totalizador?.total ?? 0 };
      }

      // Uma consulta para todos os itens da página: buscar por proposta faria
      // N+1 numa listagem, que é a lentidão clássica desta tela.
      const itens = await tx
        .select()
        .from(proposalItems)
        .where(
          and(
            eq(proposalItems.tenantId, tenantId),
            inArray(
              proposalItems.proposalId,
              cabecalhos.map((cabecalho) => cabecalho.id),
            ),
          ),
        )
        .orderBy(proposalItems.position);

      const porProposta = new Map<string, LinhaDeItem[]>();
      for (const item of itens) {
        const lista = porProposta.get(item.proposalId) ?? [];
        lista.push(item);
        porProposta.set(item.proposalId, lista);
      }

      return {
        items: cabecalhos.map((cabecalho) =>
          paraDominio(cabecalho, porProposta.get(cabecalho.id) ?? []),
        ),
        total: totalizador?.total ?? 0,
      };
    });
  }

  /**
   * Incremento atômico: `on conflict do update ... returning` trava a linha da
   * empresa e devolve o valor já incrementado num único comando. Duas
   * criações simultâneas recebem números diferentes — a segunda espera.
   */
  async reservarNumero(tenantId: string): Promise<number> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .insert(proposalNumbers)
        .values({ tenantId, lastNumber: 1 })
        .onConflictDoUpdate({
          target: proposalNumbers.tenantId,
          set: { lastNumber: sql`${proposalNumbers.lastNumber} + 1` },
        })
        .returning({ numero: proposalNumbers.lastNumber });

      if (!linha) {
        throw new Error('Não foi possível reservar o número da proposta.');
      }
      return linha.numero;
    });
  }
}

function paraDominio(
  cabecalho: LinhaDeProposta,
  itens: readonly LinhaDeItem[],
): Proposal {
  return Proposal.restore({
    id: cabecalho.id,
    tenantId: cabecalho.tenantId,
    customerId: cabecalho.customerId,
    number: cabecalho.number,
    status: cabecalho.status as ProposalStatus,
    currency: cabecalho.currency,
    title: cabecalho.title,
    notes: cabecalho.notes,
    validUntil: cabecalho.validUntil,
    items: itens.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
    })),
    createdAt: cabecalho.createdAt,
    updatedAt: cabecalho.updatedAt,
    sentAt: cabecalho.sentAt,
    decidedAt: cabecalho.decidedAt,
  });
}
