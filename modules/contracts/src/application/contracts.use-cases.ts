import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';
import type { EventPublisher } from '@ecojotaduo/events';
import type { UnitOfWork } from '@ecojotaduo/platform-kernel';

import { Contract } from '../domain/contract';
import {
  ContractNotFoundError,
  ProposalAlreadyContractedError,
  ProposalNotAcceptedError,
  ProposalNotInThisTenantError,
} from '../domain/errors';
import type { ProposalDirectory } from '../ports/proposals';
import type {
  ContractRepository,
  FiltroDeContratos,
  Paginado,
} from '../ports/repositories';

/**
 * Casos de uso de Contratos.
 *
 * A regra que define este módulo mora aqui: **contrato nasce de proposta
 * aceita**. Título, moeda, valor e cliente vêm da proposta — não são
 * informados por quem formaliza. Se fossem, o contrato poderia divergir do que
 * o cliente aceitou, e a proposta deixaria de significar alguma coisa.
 */

export class CreateContractUseCase {
  constructor(
    private readonly contratos: ContractRepository,
    private readonly propostas: ProposalDirectory,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    proposalId: string;
    startsOn: Date;
    endsOn: Date;
    notes?: string | null;
  }): Promise<Contract> {
    const proposta = await this.propostas.find(
      entrada.tenantId,
      entrada.proposalId,
    );
    if (!proposta) {
      throw new ProposalNotInThisTenantError(entrada.proposalId);
    }
    if (proposta.status !== 'accepted') {
      throw new ProposalNotAcceptedError(proposta.status);
    }

    const jaFormalizada = await this.contratos.findByProposal(
      entrada.tenantId,
      entrada.proposalId,
    );
    if (jaFormalizada) {
      throw new ProposalAlreadyContractedError(jaFormalizada.number);
    }

    const contrato = Contract.draft({
      id: randomUUID(),
      tenantId: entrada.tenantId,
      customerId: proposta.customerId,
      proposalId: proposta.proposalId,
      number: await this.contratos.reservarNumero(entrada.tenantId),
      title: proposta.title,
      currency: proposta.currency,
      valueCents: proposta.totalCents,
      startsOn: entrada.startsOn,
      endsOn: entrada.endsOn,
      notes: entrada.notes,
    });

    await this.uow.executar(entrada.tenantId, async () => {
      await this.contratos.save(entrada.tenantId, contrato);
      await this.audit.record({
        action: 'contracts.contract.created',
        result: 'success',
        resourceType: 'contract',
        resourceId: contrato.id,
        metadata: {
          number: contrato.number,
          proposalNumber: proposta.number,
          valueCents: contrato.valueCents,
          currency: contrato.currency,
        },
      });
    });

    return contrato;
  }
}

export class ActivateContractUseCase {
  constructor(
    private readonly contratos: ContractRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    contractId: string;
  }): Promise<Contract> {
    const contrato = await exigirContrato(
      this.contratos,
      entrada.tenantId,
      entrada.contractId,
    );

    contrato.activate();

    await this.uow.executar(entrada.tenantId, async () => {
      await this.contratos.save(entrada.tenantId, contrato);
      await this.eventos.publish({
        type: 'contracts.contract.activated.v1',
        resourceType: 'contract',
        resourceId: contrato.id,
        payload: {
          number: contrato.number,
          customerId: contrato.customerId,
          proposalId: contrato.proposalId,
          valueCents: contrato.valueCents,
          currency: contrato.currency,
          startsOn: contrato.startsOn.toISOString(),
          endsOn: contrato.endsOn.toISOString(),
        },
      });
      await this.audit.record({
        action: 'contracts.contract.activated',
        result: 'success',
        resourceType: 'contract',
        resourceId: contrato.id,
        metadata: {
          number: contrato.number,
          valueCents: contrato.valueCents,
          currency: contrato.currency,
          endsOn: contrato.endsOn.toISOString(),
        },
      });
    });

    return contrato;
  }
}

export class CloseContractUseCase {
  constructor(
    private readonly contratos: ContractRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  finish(entrada: {
    tenantId: string;
    contractId: string;
    reason?: string | null;
  }): Promise<Contract> {
    return this.fechar(entrada, 'finish');
  }

  cancel(entrada: {
    tenantId: string;
    contractId: string;
    reason?: string | null;
  }): Promise<Contract> {
    return this.fechar(entrada, 'cancel');
  }

  private async fechar(
    entrada: { tenantId: string; contractId: string; reason?: string | null },
    modo: 'finish' | 'cancel',
  ): Promise<Contract> {
    const contrato = await exigirContrato(
      this.contratos,
      entrada.tenantId,
      entrada.contractId,
    );

    if (modo === 'finish') {
      contrato.finish(entrada.reason ?? null);
    } else {
      contrato.cancel(entrada.reason ?? null);
    }

    const fato =
      modo === 'finish'
        ? 'contracts.contract.finished'
        : 'contracts.contract.canceled';

    await this.uow.executar(entrada.tenantId, async () => {
      await this.contratos.save(entrada.tenantId, contrato);
      await this.eventos.publish({
        type: `${fato}.v1`,
        resourceType: 'contract',
        resourceId: contrato.id,
        payload: {
          number: contrato.number,
          customerId: contrato.customerId,
          valueCents: contrato.valueCents,
          currency: contrato.currency,
          reason: contrato.closeReason,
        },
      });
      await this.audit.record({
        action: fato,
        result: 'success',
        resourceType: 'contract',
        resourceId: contrato.id,
        metadata: {
          number: contrato.number,
          valueCents: contrato.valueCents,
          currency: contrato.currency,
          reason: contrato.closeReason,
        },
      });
    });

    return contrato;
  }
}

export class GetContractUseCase {
  constructor(private readonly contratos: ContractRepository) {}

  execute(entrada: {
    tenantId: string;
    contractId: string;
  }): Promise<Contract> {
    return exigirContrato(this.contratos, entrada.tenantId, entrada.contractId);
  }
}

export class SearchContractsUseCase {
  constructor(private readonly contratos: ContractRepository) {}

  execute(
    entrada: { tenantId: string } & FiltroDeContratos,
  ): Promise<Paginado<Contract>> {
    const { tenantId, ...filtro } = entrada;
    return this.contratos.search(tenantId, filtro);
  }
}

async function exigirContrato(
  contratos: ContractRepository,
  tenantId: string,
  contractId: string,
): Promise<Contract> {
  const contrato = await contratos.findById(tenantId, contractId);
  if (!contrato) {
    throw new ContractNotFoundError(contractId);
  }
  return contrato;
}
