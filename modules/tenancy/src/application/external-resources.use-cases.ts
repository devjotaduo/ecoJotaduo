import { randomUUID } from 'node:crypto';
import { DomainError } from '@ecojotaduo/platform-kernel';
import type { TenantId } from '@ecojotaduo/tenant-context';
import {
  ExternalResource,
  type SistemaExterno,
  type TipoDeRecurso,
} from '../domain/external-resource';
import type { ExternalResourceRepository } from '../ports/external-resources.repository';

export class RecursoExternoNaoEncontradoError extends DomainError {
  readonly kind = 'not-found';
  constructor(system: SistemaExterno, tipo: TipoDeRecurso) {
    super(`Nenhum recurso ${tipo} registrado em ${system} para esta empresa.`);
  }
}

interface Alvo {
  readonly tenantId: TenantId;
  readonly system: SistemaExterno;
  readonly kind: TipoDeRecurso;
}

/**
 * Registra a INTENÇÃO de um recurso externo. Idempotente pela chave natural
 * (empresa, sistema, tipo): chamar de novo devolve o que já existe em vez de
 * criar um segundo.
 *
 * Isso não é conveniência — é o que permite o worker retomar do ponto seguro
 * depois de um reinício sem precisar saber se já tinha passado por aqui.
 */
export class RegistrarRecursoExternoUseCase {
  constructor(private readonly repo: ExternalResourceRepository) {}

  async execute(alvo: Alvo): Promise<ExternalResource> {
    const existente = await this.repo.achar(
      alvo.tenantId,
      alvo.system,
      alvo.kind,
    );
    if (existente) return existente;

    const recurso = ExternalResource.registrar({
      id: randomUUID(),
      tenantId: alvo.tenantId,
      system: alvo.system,
      kind: alvo.kind,
      agora: new Date(),
    });
    await this.repo.salvar(recurso);
    return recurso;
  }
}

/** O recurso existe do outro lado, e este é o identificador dele. */
export class ConfirmarRecursoExternoUseCase {
  constructor(private readonly repo: ExternalResourceRepository) {}

  async execute(entrada: Alvo & { externalId: string }): Promise<ExternalResource> {
    const recurso = await this.exigir(entrada);
    recurso.confirmar(entrada.externalId, new Date());
    await this.repo.salvar(recurso);
    return recurso;
  }

  private async exigir(alvo: Alvo): Promise<ExternalResource> {
    const recurso = await this.repo.achar(alvo.tenantId, alvo.system, alvo.kind);
    if (!recurso) {
      throw new RecursoExternoNaoEncontradoError(alvo.system, alvo.kind);
    }
    return recurso;
  }
}

/** Não deu para criar lá fora, e o motivo fica escrito. */
export class FalharRecursoExternoUseCase {
  constructor(private readonly repo: ExternalResourceRepository) {}

  async execute(entrada: Alvo & { motivo: string }): Promise<ExternalResource> {
    const recurso = await this.repo.achar(
      entrada.tenantId,
      entrada.system,
      entrada.kind,
    );
    if (!recurso) {
      throw new RecursoExternoNaoEncontradoError(entrada.system, entrada.kind);
    }
    recurso.falhar(entrada.motivo, new Date());
    await this.repo.salvar(recurso);
    return recurso;
  }
}

/** O recurso deixou de valer lá fora. Estado, nunca ausência. */
export class RevogarRecursoExternoUseCase {
  constructor(private readonly repo: ExternalResourceRepository) {}

  async execute(alvo: Alvo): Promise<ExternalResource> {
    const recurso = await this.repo.achar(alvo.tenantId, alvo.system, alvo.kind);
    if (!recurso) {
      throw new RecursoExternoNaoEncontradoError(alvo.system, alvo.kind);
    }
    recurso.revogar(new Date());
    await this.repo.salvar(recurso);
    return recurso;
  }
}

/**
 * A consulta que o ADR-0017 existe para tornar possível: "esta empresa está
 * inteira?". Devolve tudo o que foi registrado, incluindo pendente, falho e
 * revogado — esconder os que não estão ativos transformaria "falhou" em
 * "nunca foi pedido", que é a diferença entre investigar e não saber.
 */
export class ListarRecursosExternosUseCase {
  constructor(private readonly repo: ExternalResourceRepository) {}

  async execute(tenantId: TenantId): Promise<ExternalResource[]> {
    return this.repo.listar(tenantId);
  }
}
