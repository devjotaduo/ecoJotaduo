import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';

import {
  CustomerNotInThisTenantError,
  ProposalNotFoundError,
} from '../domain/errors';
import { Proposal, ProposalItem } from '../domain/proposal';
import type { CustomerDirectory } from '../ports/customers';
import type {
  FiltroDePropostas,
  Paginado,
  ProposalRepository,
} from '../ports/repositories';

/**
 * Casos de uso do Comercial.
 *
 * Nenhuma regra mora aqui: quem decide se a proposta pode ser alterada,
 * enviada ou aceita é o agregado. O que a aplicação faz é buscar, orquestrar,
 * persistir e auditar — e conferir as referências que cruzam módulo.
 */

export interface ItemInformado {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly discountCents?: number;
}

/** Monta os itens; `Money` e `ProposalItem` recusam o que não fecha. */
function montarItens(
  itens: readonly ItemInformado[],
  currency: string,
): ProposalItem[] {
  return itens.map((item) =>
    ProposalItem.create({ id: randomUUID(), currency, ...item }),
  );
}

export class CreateProposalUseCase {
  constructor(
    private readonly propostas: ProposalRepository,
    private readonly clientes: CustomerDirectory,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    customerId: string;
    title: string;
    currency: string;
    validUntil: Date;
    notes?: string | null;
    items?: readonly ItemInformado[];
  }): Promise<Proposal> {
    // Referência cruzando módulo: conferida contra a superfície pública do
    // CRM. Sem isto, a proposta apontaria para um cliente inexistente — ou,
    // pior, para um id de OUTRA empresa.
    const nome = await this.clientes.findName(
      entrada.tenantId,
      entrada.customerId,
    );
    if (!nome) {
      throw new CustomerNotInThisTenantError(entrada.customerId);
    }

    const proposta = Proposal.create({
      id: randomUUID(),
      tenantId: entrada.tenantId,
      customerId: entrada.customerId,
      number: await this.propostas.reservarNumero(entrada.tenantId),
      title: entrada.title,
      currency: entrada.currency,
      validUntil: entrada.validUntil,
      notes: entrada.notes,
    });

    if (entrada.items?.length) {
      proposta.replaceItems(montarItens(entrada.items, entrada.currency));
    }

    await this.propostas.save(entrada.tenantId, proposta);
    await this.audit.record({
      action: 'commercial.proposal.created',
      result: 'success',
      resourceType: 'proposal',
      resourceId: proposta.id,
      metadata: { number: proposta.number, customerId: entrada.customerId },
    });

    return proposta;
  }
}

export class UpdateProposalUseCase {
  constructor(
    private readonly propostas: ProposalRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    proposalId: string;
    title?: string;
    notes?: string | null;
    validUntil?: Date;
    items?: readonly ItemInformado[];
  }): Promise<Proposal> {
    const proposta = await exigirProposta(
      this.propostas,
      entrada.tenantId,
      entrada.proposalId,
    );

    proposta.atualizarCabecalho({
      title: entrada.title,
      notes: entrada.notes,
      validUntil: entrada.validUntil,
    });
    if (entrada.items) {
      proposta.replaceItems(montarItens(entrada.items, proposta.currency));
    }

    await this.propostas.save(entrada.tenantId, proposta);
    await this.audit.record({
      action: 'commercial.proposal.updated',
      result: 'success',
      resourceType: 'proposal',
      resourceId: proposta.id,
      metadata: { totalCents: proposta.total.cents },
    });

    return proposta;
  }
}

export class SendProposalUseCase {
  constructor(
    private readonly propostas: ProposalRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    proposalId: string;
  }): Promise<Proposal> {
    const proposta = await exigirProposta(
      this.propostas,
      entrada.tenantId,
      entrada.proposalId,
    );

    proposta.send();
    await this.propostas.save(entrada.tenantId, proposta);
    await this.audit.record({
      action: 'commercial.proposal.sent',
      result: 'success',
      resourceType: 'proposal',
      resourceId: proposta.id,
      metadata: {
        number: proposta.number,
        totalCents: proposta.total.cents,
        currency: proposta.currency,
      },
    });

    return proposta;
  }
}

export class DecideProposalUseCase {
  constructor(
    private readonly propostas: ProposalRepository,
    private readonly audit: AuditLogger,
  ) {}

  accept(entrada: { tenantId: string; proposalId: string }): Promise<Proposal> {
    return this.decidir(entrada, 'accept');
  }

  reject(entrada: { tenantId: string; proposalId: string }): Promise<Proposal> {
    return this.decidir(entrada, 'reject');
  }

  private async decidir(
    entrada: { tenantId: string; proposalId: string },
    decisao: 'accept' | 'reject',
  ): Promise<Proposal> {
    const proposta = await exigirProposta(
      this.propostas,
      entrada.tenantId,
      entrada.proposalId,
    );

    if (decisao === 'accept') {
      proposta.accept();
    } else {
      proposta.reject();
    }

    await this.propostas.save(entrada.tenantId, proposta);
    await this.audit.record({
      action:
        decisao === 'accept'
          ? 'commercial.proposal.accepted'
          : 'commercial.proposal.rejected',
      result: 'success',
      resourceType: 'proposal',
      resourceId: proposta.id,
      // O valor fechado entra na trilha: é o que se audita numa venda.
      metadata: {
        number: proposta.number,
        totalCents: proposta.total.cents,
        currency: proposta.currency,
      },
    });

    return proposta;
  }
}

export interface PropostaComCliente {
  readonly proposal: Proposal;
  readonly customerName: string | null;
}

export class GetProposalUseCase {
  constructor(
    private readonly propostas: ProposalRepository,
    private readonly clientes: CustomerDirectory,
  ) {}

  async execute(entrada: {
    tenantId: string;
    proposalId: string;
  }): Promise<PropostaComCliente> {
    const proposal = await exigirProposta(
      this.propostas,
      entrada.tenantId,
      entrada.proposalId,
    );
    return {
      proposal,
      customerName: await this.clientes.findName(
        entrada.tenantId,
        proposal.customerId,
      ),
    };
  }
}

export class SearchProposalsUseCase {
  constructor(private readonly propostas: ProposalRepository) {}

  execute(
    entrada: { tenantId: string } & FiltroDePropostas,
  ): Promise<Paginado<Proposal>> {
    const { tenantId, ...filtro } = entrada;
    return this.propostas.search(tenantId, filtro);
  }
}

async function exigirProposta(
  propostas: ProposalRepository,
  tenantId: string,
  proposalId: string,
): Promise<Proposal> {
  const proposta = await propostas.findById(tenantId, proposalId);
  if (!proposta) {
    throw new ProposalNotFoundError(proposalId);
  }
  return proposta;
}
