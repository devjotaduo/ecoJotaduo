import { describe, expect, it } from 'vitest';
import { toTenantId } from '@ecojotaduo/tenant-context';
import {
  ExternalResource,
  IdentificadorExternoAusenteError,
  RecursoExternoRevogadoError,
} from '../src/domain/external-resource';

const TENANT = toTenantId('7f1c5d0e-2f4a-4a3b-9f7e-5b6c1d2e3f40');
const T0 = new Date('2026-08-22T12:00:00Z');
const T1 = new Date('2026-08-22T12:05:00Z');

function novo() {
  return ExternalResource.registrar({
    id: 'a3b1c2d4-0000-4000-8000-000000000001',
    tenantId: TENANT,
    system: 'studio',
    kind: 'group',
    agora: T0,
  });
}

describe('ExternalResource', () => {
  it('nasce pendente e sem identificador — pedimos, ainda não existe lá fora', () => {
    const r = novo();
    expect(r.state).toBe('pending');
    expect(r.externalId).toBeNull();
  });

  it('confirmar publica o identificador e limpa a falha anterior', () => {
    const r = novo();
    r.falhar('o Studio recusou', T0);
    r.confirmar('  grp-123  ', T1);

    expect(r.state).toBe('active');
    expect(r.externalId).toBe('grp-123');
    expect(r.failureReason).toBeNull();
    expect(r.updatedAt).toEqual(T1);
  });

  it('confirmar sem identificador é recusado', () => {
    const r = novo();
    expect(() => r.confirmar('   ', T1)).toThrow(
      IdentificadorExternoAusenteError,
    );
    expect(r.state).toBe('pending');
  });

  it('falhar exige motivo, e inventa um em vez de guardar vazio', () => {
    const r = novo();
    r.falhar('   ', T1);
    expect(r.state).toBe('failed');
    expect(r.failureReason).toBeTruthy();
  });

  // A propriedade que este tipo existe para garantir. Um registro que devolve
  // identificador de recurso que já não vale faz o chamador agir sobre um
  // grupo, chave ou workspace que não é mais dele.
  it('identificador só é observável quando ativo — some ao falhar e ao revogar', () => {
    const r = novo();
    r.confirmar('grp-123', T0);
    expect(r.externalId).toBe('grp-123');

    r.falhar('o grupo sumiu', T1);
    expect(r.externalId).toBeNull();

    const outro = novo();
    outro.confirmar('grp-999', T0);
    outro.revogar(T1);
    expect(outro.externalId).toBeNull();
  });

  it('revogado não volta a valer — recurso novo é registro novo', () => {
    const r = novo();
    r.confirmar('grp-123', T0);
    r.revogar(T1);

    expect(() => r.confirmar('grp-456', T1)).toThrow(
      RecursoExternoRevogadoError,
    );
    expect(() => r.falhar('qualquer', T1)).toThrow(RecursoExternoRevogadoError);
    expect(r.state).toBe('revoked');
  });

  it('revogar duas vezes não muda nada', () => {
    const r = novo();
    r.revogar(T0);
    r.revogar(T1);
    expect(r.state).toBe('revoked');
    expect(r.updatedAt).toEqual(T0);
  });

  // O banco guarda o identificador mesmo revogado — é a evidência de qual
  // recurso pertenceu a quem. Quem esconde é o domínio, na leitura.
  it('a persistência mantém o identificador que o getter esconde', () => {
    const r = novo();
    r.confirmar('grp-123', T0);
    r.revogar(T1);
    expect(r.externalId).toBeNull();
    expect(r.paraPersistencia().externalId).toBe('grp-123');
  });
});
