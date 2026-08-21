import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { TenantId, UserId } from './ids';

/** Por qual borda a operação entrou — vai para a auditoria. */
export type Channel = 'rest' | 'mcp' | 'job' | 'webhook' | 'system';

export type ActorKind = 'user' | 'service' | 'system';

/**
 * COMO a requisição se autenticou.
 *
 * Não é a mesma coisa que `ActorKind`: um token pessoal e um login são a mesma
 * PESSOA agindo, por credenciais de risco diferente. A distinção importa em
 * dois lugares — operações que exigem sessão de verdade (emitir outro token
 * pessoal, por exemplo) e a trilha, onde vale saber que a ação veio de um
 * agente e não de alguém na tela.
 */
export type CredentialKind = 'session' | 'personal-token' | 'service';

export interface Actor {
  readonly kind: ActorKind;
  /** userId (usuário) ou id da service account. */
  readonly id: string;
  readonly label?: string;
}

/** Preenchido somente após autenticação bem-sucedida. */
export interface AuthenticatedContext {
  readonly tenantId: TenantId;
  readonly actor: Actor;
  /** Padrão `session`: a maioria das bordas autentica por login. */
  readonly credential?: CredentialKind;
  readonly userId?: UserId;
  readonly permissions: readonly string[];
  readonly scopes: readonly string[];
  readonly entitlements: readonly string[];
}

export interface RequestContext {
  readonly correlationId: string;
  readonly channel: Channel;
  readonly startedAt: Date;
  /** Indefinido enquanto a requisição for anônima. */
  auth?: AuthenticatedContext;
}

export class MissingContextError extends Error {
  constructor(detalhe: string) {
    super(detalhe);
    this.name = 'MissingContextError';
  }
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createContext(
  channel: Channel,
  correlationId: string = randomUUID(),
): RequestContext {
  return { correlationId, channel, startedAt: new Date() };
}

/** Executa `fn` com o contexto ativo; tudo abaixo na cadeia async o enxerga. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireContext(): RequestContext {
  const context = storage.getStore();
  if (!context) {
    throw new MissingContextError(
      'Nenhum RequestContext ativo. Toda operação precisa entrar por runWithContext.',
    );
  }
  return context;
}

/**
 * Contexto autenticado obrigatório. Repositórios e casos de uso usam isto —
 * é o que garante que nenhuma consulta roda sem tenant.
 */
export function requireAuth(): AuthenticatedContext {
  const { auth } = requireContext();
  if (!auth) {
    throw new MissingContextError(
      'Operação exige contexto autenticado (tenant não resolvido).',
    );
  }
  return auth;
}

export function requireTenantId(): TenantId {
  return requireAuth().tenantId;
}

/** Chamado uma única vez pelo guard de autenticação. */
export function authenticateContext(
  context: RequestContext,
  auth: AuthenticatedContext,
): void {
  if (context.auth) {
    throw new MissingContextError('O contexto já foi autenticado.');
  }
  context.auth = auth;
}
