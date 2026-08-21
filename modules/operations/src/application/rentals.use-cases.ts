import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';
import type { EventPublisher } from '@ecojotaduo/events';
import type { UnitOfWork } from '@ecojotaduo/platform-kernel';

import {
  AssetNotInThisTenantError,
  ContractNotActiveError,
  ContractNotInThisTenantError,
  RentalNotFoundError,
  RentalOutsideContractTermError,
} from '../domain/errors';
import { Rental } from '../domain/rental';
import type { AssetDirectory } from '../ports/assets';
import type { ContractDirectory } from '../ports/contracts';
import type {
  FiltroDeLocacoes,
  Paginado,
  RentalRepository,
} from '../ports/repositories';

/**
 * Casos de uso de Operações.
 *
 * As duas regras que definem o módulo:
 *
 * 1. **Locação nasce de contrato em vigor**, e cabe dentro da vigência dele.
 *    Equipamento na rua fora da vigência não tem o que o cubra — nem
 *    comercialmente, nem em caso de sinistro.
 *
 * 2. **A locação reserva o equipamento no patrimônio.** Não existe "marcar
 *    como locado" aqui: quem sabe se o equipamento está livre é Ativos, e é
 *    lá que a reserva vira uma linha que a restrição de exclusão protege.
 *    Duas locações do mesmo equipamento no mesmo período são impossíveis pelo
 *    banco, não por acordo entre módulos.
 */

export class ScheduleRentalUseCase {
  constructor(
    private readonly locacoes: RentalRepository,
    private readonly contratos: ContractDirectory,
    private readonly ativos: AssetDirectory,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    contractId: string;
    assetId: string;
    startsAt: Date;
    endsAt: Date;
    notes?: string | null;
  }): Promise<Rental> {
    const contrato = await this.contratos.find(
      entrada.tenantId,
      entrada.contractId,
    );
    if (!contrato) {
      throw new ContractNotInThisTenantError(entrada.contractId);
    }
    // `status` já vem com a vigência aplicada: um contrato vencido chega aqui
    // como "expired", e não como "active".
    if (contrato.status !== 'active') {
      throw new ContractNotActiveError(contrato.status);
    }
    if (
      entrada.startsAt.getTime() < contrato.startsOn.getTime() ||
      entrada.endsAt.getTime() > contrato.endsOn.getTime()
    ) {
      throw new RentalOutsideContractTermError(
        contrato.startsOn,
        contrato.endsOn,
      );
    }

    const equipamento = await this.ativos.find(
      entrada.tenantId,
      entrada.assetId,
    );
    if (!equipamento) {
      throw new AssetNotInThisTenantError(entrada.assetId);
    }

    // Reserva no patrimônio e gravação da locação na MESMA transação.
    //
    // Até a Fase 8 isto eram duas transações com compensação: reservava-se
    // primeiro e, se a gravação falhasse, tentava-se liberar. Compensação que
    // também falha deixa o equipamento bloqueado sem nenhuma locação que
    // explique o bloqueio — e ninguém descobre por que a máquina não sai.
    // Dentro da unidade, o rollback desfaz as duas de uma vez.
    //
    // A reserva continua vindo primeiro: se o equipamento estiver comprometido
    // no intervalo, Ativos recusa aqui e nada chega a ser gravado.
    return this.uow.executar(entrada.tenantId, async () => {
      const reserva = await this.ativos.reservar(entrada.tenantId, {
        assetId: entrada.assetId,
        startsAt: entrada.startsAt,
        endsAt: entrada.endsAt,
        notes: `Locação sob o contrato nº ${contrato.number}`,
      });

      const locacao = Rental.schedule({
        id: randomUUID(),
        tenantId: entrada.tenantId,
        number: await this.locacoes.reservarNumero(entrada.tenantId),
        contractId: contrato.contractId,
        // Cliente vem do CONTRATO, não de quem programa: a locação é para
        // quem assinou, e não para quem o operador digitar.
        customerId: contrato.customerId,
        assetId: equipamento.assetId,
        assetCode: equipamento.code,
        holdId: reserva.holdId,
        startsAt: entrada.startsAt,
        endsAt: entrada.endsAt,
        notes: entrada.notes,
      });

      await this.locacoes.save(entrada.tenantId, locacao);
      await this.audit.record({
        action: 'operations.rental.scheduled',
        result: 'success',
        resourceType: 'rental',
        resourceId: locacao.id,
        metadata: {
          number: locacao.number,
          contractNumber: contrato.number,
          assetCode: locacao.assetCode,
          holdId: locacao.holdId,
          startsAt: locacao.startsAt.toISOString(),
          endsAt: locacao.endsAt.toISOString(),
        },
      });

      return locacao;
    });
  }
}

export class StartRentalUseCase {
  constructor(
    private readonly locacoes: RentalRepository,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    rentalId: string;
  }): Promise<Rental> {
    const locacao = await exigirLocacao(
      this.locacoes,
      entrada.tenantId,
      entrada.rentalId,
    );

    locacao.start();

    // Gravacao, evento e trilha na MESMA transacao: nenhum consumidor pode
    // saber de uma retirada que o banco desfez.
    await this.uow.executar(entrada.tenantId, async () => {
      await this.locacoes.save(entrada.tenantId, locacao);
      await this.eventos.publish({
        type: 'operations.rental.started.v1',
        resourceType: 'rental',
        resourceId: locacao.id,
        payload: {
          number: locacao.number,
          contractId: locacao.contractId,
          customerId: locacao.customerId,
          assetId: locacao.assetId,
          assetCode: locacao.assetCode,
          endsAt: locacao.endsAt.toISOString(),
        },
      });
      await this.audit.record({
        action: 'operations.rental.started',
        result: 'success',
        resourceType: 'rental',
        resourceId: locacao.id,
        metadata: { number: locacao.number, assetCode: locacao.assetCode },
      });
    });

    return locacao;
  }
}

export class FinishRentalUseCase {
  constructor(
    private readonly locacoes: RentalRepository,
    private readonly ativos: AssetDirectory,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    rentalId: string;
    reason?: string | null;
  }): Promise<Rental> {
    const locacao = await exigirLocacao(
      this.locacoes,
      entrada.tenantId,
      entrada.rentalId,
    );

    // Quantos dias de atraso ANTES de encerrar: depois de `finish()` a
    // situação vira `finished` e o número se perde. É o que a cobrança usa.
    const atraso = locacao.diasDeAtraso();
    locacao.finish(entrada.reason ?? null);

    await this.uow.executar(entrada.tenantId, async () => {
      await this.locacoes.save(entrada.tenantId, locacao);
      // O equipamento volta ao pátio: a reserva é liberada AGORA, mesmo que o
      // prazo previsto fosse mais longo. Sem isso, devolver adiantado deixaria
      // o equipamento parado até a data original. Dentro da unidade, devolução
      // e liberação caem juntas se qualquer uma falhar.
      await this.ativos.liberar(entrada.tenantId, locacao.holdId);
      await this.eventos.publish({
        type: 'operations.rental.finished.v1',
        resourceType: 'rental',
        resourceId: locacao.id,
        payload: {
          number: locacao.number,
          contractId: locacao.contractId,
          customerId: locacao.customerId,
          assetId: locacao.assetId,
          assetCode: locacao.assetCode,
          // Vai no evento porque é o que a cobrança extra usa, e depois do
          // encerramento não dá mais para recalcular.
          overdueDays: atraso,
        },
      });
      await this.audit.record({
        action: 'operations.rental.finished',
        result: 'success',
        resourceType: 'rental',
        resourceId: locacao.id,
        metadata: {
          number: locacao.number,
          assetCode: locacao.assetCode,
          overdueDays: atraso,
          reason: locacao.closeReason,
        },
      });
    });

    return locacao;
  }
}

export class CancelRentalUseCase {
  constructor(
    private readonly locacoes: RentalRepository,
    private readonly ativos: AssetDirectory,
    private readonly uow: UnitOfWork,
    private readonly eventos: EventPublisher,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    rentalId: string;
    reason?: string | null;
  }): Promise<Rental> {
    const locacao = await exigirLocacao(
      this.locacoes,
      entrada.tenantId,
      entrada.rentalId,
    );

    locacao.cancel(entrada.reason ?? null);

    await this.uow.executar(entrada.tenantId, async () => {
      await this.locacoes.save(entrada.tenantId, locacao);
      await this.ativos.liberar(entrada.tenantId, locacao.holdId);
      await this.eventos.publish({
        type: 'operations.rental.canceled.v1',
        resourceType: 'rental',
        resourceId: locacao.id,
        payload: {
          number: locacao.number,
          contractId: locacao.contractId,
          customerId: locacao.customerId,
          assetId: locacao.assetId,
          assetCode: locacao.assetCode,
          reason: locacao.closeReason,
        },
      });
      await this.audit.record({
        action: 'operations.rental.canceled',
        result: 'success',
        resourceType: 'rental',
        resourceId: locacao.id,
        metadata: {
          number: locacao.number,
          assetCode: locacao.assetCode,
          reason: locacao.closeReason,
        },
      });
    });

    return locacao;
  }
}

export class GetRentalUseCase {
  constructor(private readonly locacoes: RentalRepository) {}

  execute(entrada: { tenantId: string; rentalId: string }): Promise<Rental> {
    return exigirLocacao(this.locacoes, entrada.tenantId, entrada.rentalId);
  }
}

export class SearchRentalsUseCase {
  constructor(private readonly locacoes: RentalRepository) {}

  execute(
    entrada: { tenantId: string } & FiltroDeLocacoes,
  ): Promise<Paginado<Rental>> {
    const { tenantId, ...filtro } = entrada;
    return this.locacoes.search(tenantId, filtro);
  }
}

async function exigirLocacao(
  locacoes: RentalRepository,
  tenantId: string,
  rentalId: string,
): Promise<Rental> {
  const locacao = await locacoes.findById(tenantId, rentalId);
  if (!locacao) {
    throw new RentalNotFoundError(rentalId);
  }
  return locacao;
}
