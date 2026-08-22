import type { TenantId } from '@ecojotaduo/tenant-context';
import type {
  ExternalResource,
  SistemaExterno,
  TipoDeRecurso,
} from '../domain/external-resource';

/**
 * Porta do registro de recursos externos.
 *
 * Toda operação leva o tenant explícito porque toda consulta roda sob escopo
 * (`withTenant`) — e o sintoma de esquecer o escopo aqui não seria erro, seria
 * ZERO LINHAS: a empresa pareceria não provisionada e alguém a provisionaria
 * de novo.
 */
export interface ExternalResourceRepository {
  achar(
    tenantId: TenantId,
    system: SistemaExterno,
    kind: TipoDeRecurso,
  ): Promise<ExternalResource | null>;

  /** Todos os recursos da empresa — a consulta "esta empresa está inteira?". */
  listar(tenantId: TenantId): Promise<ExternalResource[]>;

  /** Cria ou atualiza pelo par (empresa, sistema, tipo). */
  salvar(recurso: ExternalResource): Promise<void>;
}
