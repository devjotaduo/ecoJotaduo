import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import {
  authenticateContext,
  createContext,
  getContext,
  MissingContextError,
  requireAuth,
  requireTenantId,
  runWithContext,
  type AuthenticatedContext,
} from './context';
import { InvalidIdError, toTenantId, toUserId } from './ids';

function authFake(tenant: string): AuthenticatedContext {
  return {
    tenantId: toTenantId(tenant),
    actor: { kind: 'user', id: 'ator' },
    permissions: ['*'],
    scopes: ['*'],
    entitlements: ['crm'],
  };
}

const TENANT_A = '019a0000-0000-7000-8000-00000000000a';
const TENANT_B = '019a0000-0000-7000-8000-00000000000b';

describe('identificadores opacos', () => {
  it('aceita UUID válido', () => {
    expect(toTenantId(TENANT_A)).toBe(TENANT_A);
    expect(toUserId(randomUUID())).toBeTypeOf('string');
  });

  it('rejeita valor que não é UUID', () => {
    expect(() => toTenantId('tenant-a')).toThrow(InvalidIdError);
    expect(() => toTenantId("' OR 1=1 --")).toThrow(InvalidIdError);
  });
});

describe('RequestContext', () => {
  it('exige contexto ativo para operar', () => {
    expect(() => requireTenantId()).toThrow(MissingContextError);
    expect(getContext()).toBeUndefined();
  });

  it('exige autenticação antes de expor o tenant', () => {
    runWithContext(createContext('rest'), () => {
      expect(() => requireAuth()).toThrow(MissingContextError);
    });
  });

  it('expõe o tenant após autenticar', () => {
    const contexto = createContext('rest');
    runWithContext(contexto, () => {
      authenticateContext(contexto, authFake(TENANT_A));
      expect(requireTenantId()).toBe(TENANT_A);
    });
  });

  it('impede reautenticar o mesmo contexto (troca de tenant no meio)', () => {
    const contexto = createContext('rest');
    runWithContext(contexto, () => {
      authenticateContext(contexto, authFake(TENANT_A));
      expect(() => authenticateContext(contexto, authFake(TENANT_B))).toThrow(
        MissingContextError,
      );
      expect(requireTenantId()).toBe(TENANT_A);
    });
  });

  it('mantém contextos concorrentes isolados entre si', async () => {
    async function operacao(tenant: string): Promise<string> {
      const contexto = createContext('rest');
      return runWithContext(contexto, async () => {
        authenticateContext(contexto, authFake(tenant));
        // Interrompe a execução: se o contexto vazasse entre tarefas
        // concorrentes, o tenant lido depois do await seria o do outro.
        await sleep(5);
        return requireTenantId();
      });
    }

    const [a, b] = await Promise.all([operacao(TENANT_A), operacao(TENANT_B)]);

    expect(a).toBe(TENANT_A);
    expect(b).toBe(TENANT_B);
  });

  it('propaga correlationId único por requisição', () => {
    const primeiro = createContext('mcp');
    const segundo = createContext('mcp');
    expect(primeiro.correlationId).not.toBe(segundo.correlationId);
    expect(primeiro.channel).toBe('mcp');
  });
});
