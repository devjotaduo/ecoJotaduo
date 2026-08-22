import { DomainError } from '@ecojotaduo/platform-kernel';
import type { TenantId } from '@ecojotaduo/tenant-context';

/**
 * Um recurso que existe FORA desta plataforma e pertence a uma empresa daqui:
 * o grupo no Studio, a chave no OmniRoute, o perfil no Hermes, o workspace no
 * CRM, o slot do WhatsApp.
 *
 * A propriedade que este tipo existe para garantir: `externalId` só é
 * observável quando o recurso está `active`. Enquanto ele não existe lá fora,
 * não há identificador para guardar — e um registro que devolve identificador
 * de recurso inexistente é pior que um registro vazio, porque quem consulta
 * age sobre ele.
 */
export const SISTEMAS_EXTERNOS = [
  'studio',
  'omniroute',
  'hermes',
  'crm',
  'whatsapp',
] as const;
export type SistemaExterno = (typeof SISTEMAS_EXTERNOS)[number];

export const TIPOS_DE_RECURSO = [
  'group',
  'service-account',
  'api-key',
  'profile',
  'workspace',
  'owner-slot',
  'public-slot',
] as const;
export type TipoDeRecurso = (typeof TIPOS_DE_RECURSO)[number];

export type EstadoDoRecurso = 'pending' | 'active' | 'failed' | 'revoked';

export class RecursoExternoRevogadoError extends DomainError {
  readonly kind = 'conflict';
  constructor(system: SistemaExterno, kind: TipoDeRecurso) {
    super(
      `O recurso ${kind} em ${system} está revogado e não volta a valer. ` +
        `Registre um novo.`,
    );
  }
}

export class IdentificadorExternoAusenteError extends DomainError {
  readonly kind = 'invalid-request';
  constructor(system: SistemaExterno, kind: TipoDeRecurso) {
    super(
      `Confirmar o recurso ${kind} em ${system} exige o identificador que o ` +
        `sistema de destino devolveu.`,
    );
  }
}

export interface DadosDoRecursoExterno {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly system: SistemaExterno;
  readonly kind: TipoDeRecurso;
  readonly externalId: string | null;
  readonly state: EstadoDoRecurso;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class ExternalResource {
  private constructor(private dados: DadosDoRecursoExterno) {}

  static de(dados: DadosDoRecursoExterno): ExternalResource {
    return new ExternalResource(dados);
  }

  /** Nasce `pending`: pedimos, e ainda não existe do outro lado. */
  static registrar(entrada: {
    id: string;
    tenantId: TenantId;
    system: SistemaExterno;
    kind: TipoDeRecurso;
    agora: Date;
  }): ExternalResource {
    return new ExternalResource({
      id: entrada.id,
      tenantId: entrada.tenantId,
      system: entrada.system,
      kind: entrada.kind,
      externalId: null,
      state: 'pending',
      failureReason: null,
      createdAt: entrada.agora,
      updatedAt: entrada.agora,
    });
  }

  get id(): string {
    return this.dados.id;
  }
  get tenantId(): TenantId {
    return this.dados.tenantId;
  }
  get system(): SistemaExterno {
    return this.dados.system;
  }
  get kind(): TipoDeRecurso {
    return this.dados.kind;
  }
  get state(): EstadoDoRecurso {
    return this.dados.state;
  }
  get failureReason(): string | null {
    return this.dados.failureReason;
  }
  get createdAt(): Date {
    return this.dados.createdAt;
  }
  get updatedAt(): Date {
    return this.dados.updatedAt;
  }

  /**
   * O identificador externo só é observável quando o recurso está no ar.
   * Fora disso é `null` — nunca o valor de uma tentativa que não deu certo.
   */
  get externalId(): string | null {
    return this.dados.state === 'active' ? this.dados.externalId : null;
  }

  /** O recurso existe do outro lado, e este é o identificador dele. */
  confirmar(externalId: string, agora: Date): void {
    this.recusarSeRevogado();
    const limpo = externalId.trim();
    if (!limpo) {
      throw new IdentificadorExternoAusenteError(
        this.dados.system,
        this.dados.kind,
      );
    }
    this.dados = {
      ...this.dados,
      externalId: limpo,
      state: 'active',
      failureReason: null,
      updatedAt: agora,
    };
  }

  /**
   * Não deu para criar. O motivo é obrigatório: recurso falho sem motivo
   * escrito é indistinguível de recurso esquecido, e ninguém investiga o que
   * não tem explicação. Uma nova tentativa reescreve o estado.
   */
  falhar(motivo: string, agora: Date): void {
    this.recusarSeRevogado();
    const limpo = motivo.trim();
    this.dados = {
      ...this.dados,
      state: 'failed',
      failureReason: limpo || 'motivo não informado pelo sistema de destino',
      updatedAt: agora,
    };
  }

  /**
   * O recurso deixou de valer lá fora. Estado, não ausência: apagar a linha
   * perderia a única evidência de que aquele grupo, chave ou workspace um dia
   * existiu e a quem pertencia. Revogar não tem volta — um recurso novo é um
   * registro novo.
   */
  revogar(agora: Date): void {
    if (this.dados.state === 'revoked') return;
    this.dados = { ...this.dados, state: 'revoked', updatedAt: agora };
  }

  paraPersistencia(): DadosDoRecursoExterno {
    return { ...this.dados };
  }

  private recusarSeRevogado(): void {
    if (this.dados.state === 'revoked') {
      throw new RecursoExternoRevogadoError(this.dados.system, this.dados.kind);
    }
  }
}
