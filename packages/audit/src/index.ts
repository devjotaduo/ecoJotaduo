/**
 * Porta de auditoria. Casos de uso dependem apenas deste arquivo — o
 * adaptador PostgreSQL vive em `@ecojotaduo/audit/drizzle`.
 */

export type AuditResult = 'success' | 'denied' | 'error';

export interface AuditEntry {
  /** Ação no formato `modulo.recurso.acao`, ex.: `tenancy.module.granted`. */
  readonly action: string;
  readonly result: AuditResult;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly durationMs?: number;
  /**
   * Contexto adicional da ação. NUNCA inclua segredos, tokens, senhas ou o
   * conteúdo integral de registros — apenas o suficiente para investigar.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditRecord extends AuditEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly actorKind: string;
  readonly actorId: string;
  readonly channel: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
}

export interface AuditQuery {
  readonly action?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface AuditLogger {
  /** Tenant, ator, canal e correlação vêm do contexto — não do chamador. */
  record(entry: AuditEntry): Promise<void>;
  list(query: AuditQuery): Promise<{ items: AuditRecord[]; total: number }>;
}

/**
 * Ação registrada quando a cadeia de autorização recusa uma requisição.
 *
 * É uma constante e não um literal solto porque as duas bordas (REST e MCP)
 * precisam gravar a MESMA ação: um agente sondando o catálogo e um cliente
 * batendo em rota proibida têm de aparecer na mesma consulta.
 */
export const ACAO_DE_NEGACAO = 'platform.access.denied';

/**
 * Deixa rastro de uma recusa de acesso.
 *
 * Falhar ao auditar **não** pode transformar a recusa em erro interno: quem
 * chamou já foi barrado, e é isso que importa para a segurança da requisição.
 * A falha vai para o log de erro — sem silêncio — e a recusa segue seu curso.
 *
 * `alvo` é o que foi tentado (rota HTTP, nome da tool, URI do recurso). Nunca
 * inclua corpo da requisição nem argumentos: eles carregam dado de negócio, e
 * a trilha responde "quem tentou o quê", não "com quais valores".
 */
export async function registrarNegacao(
  audit: AuditLogger,
  dados: {
    readonly alvo: string;
    readonly required: string;
    readonly reason: string;
    readonly moduleId?: string;
  },
): Promise<void> {
  try {
    await audit.record({
      action: ACAO_DE_NEGACAO,
      result: 'denied',
      resourceType: 'access',
      resourceId: dados.alvo,
      metadata: {
        required: dados.required,
        reason: dados.reason,
        ...(dados.moduleId ? { moduleId: dados.moduleId } : {}),
      },
    });
  } catch (erro) {
    console.error(
      '[audit] não foi possível registrar a negação de acesso',
      erro,
    );
  }
}

/** Implementação nula para testes que não exercitam auditoria. */
export class NoopAuditLogger implements AuditLogger {
  readonly entries: AuditEntry[] = [];

  record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }

  list(): Promise<{ items: AuditRecord[]; total: number }> {
    return Promise.resolve({ items: [], total: 0 });
  }
}
