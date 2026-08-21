import { describe, expect, it } from 'vitest';

import {
  Contract,
  ContractNotActiveError,
  ContractNotDraftError,
  ContractTermEndedError,
  InvalidContractTermError,
} from '../src/index';

const AGORA = new Date('2026-08-20T12:00:00.000Z');
const INICIO = new Date('2026-09-01T00:00:00.000Z');
const FIM = new Date('2026-12-01T00:00:00.000Z');
const DEPOIS_DO_FIM = new Date('2026-12-02T00:00:00.000Z');

function rascunho(entrada: { startsOn?: Date; endsOn?: Date } = {}) {
  return Contract.draft({
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    customerId: '33333333-3333-4333-8333-333333333333',
    proposalId: '44444444-4444-4444-8444-444444444444',
    number: 1,
    title: 'Locação de equipamentos',
    currency: 'BRL',
    valueCents: 450_000,
    startsOn: entrada.startsOn ?? INICIO,
    endsOn: entrada.endsOn ?? FIM,
    agora: AGORA,
  });
}

describe('vigência', () => {
  it('recusa término antes do início', () => {
    expect(() => rascunho({ startsOn: FIM, endsOn: INICIO })).toThrow(
      InvalidContractTermError,
    );
  });

  it('recusa vigência que já teria terminado', () => {
    expect(() =>
      rascunho({
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toThrow(InvalidContractTermError);
  });
});

describe('ciclo do contrato', () => {
  it('nasce em rascunho, sem estar em vigor', () => {
    const contrato = rascunho();
    expect(contrato.status).toBe('draft');
    expect(contrato.emVigor(AGORA)).toBe(false);
    expect(contrato.activatedAt).toBeNull();
  });

  it('ativa e passa a valer quando o início chega', () => {
    const contrato = rascunho();
    contrato.activate(AGORA);

    expect(contrato.status).toBe('active');
    // Ativado, mas a vigência só começa em setembro.
    expect(contrato.emVigor(AGORA)).toBe(false);
    expect(contrato.emVigor(new Date('2026-10-01T00:00:00.000Z'))).toBe(true);
  });

  it('não ativa duas vezes', () => {
    const contrato = rascunho();
    contrato.activate(AGORA);
    expect(() => contrato.activate(AGORA)).toThrow(ContractNotDraftError);
  });

  it('não ativa contrato cuja vigência já passou', () => {
    // Um contrato não nasce vencido — é sinal de data errada.
    const contrato = rascunho();
    expect(() => contrato.activate(DEPOIS_DO_FIM)).toThrow(
      ContractTermEndedError,
    );
  });

  it('só encerra o que está ativo', () => {
    expect(() => rascunho().finish(null, AGORA)).toThrow(
      ContractNotActiveError,
    );
  });

  it('encerra com motivo e vira final', () => {
    const contrato = rascunho();
    contrato.activate(AGORA);
    contrato.finish('  entrega concluída  ', AGORA);

    expect(contrato.status).toBe('finished');
    expect(contrato.closeReason).toBe('entrega concluída');
    expect(() => contrato.cancel(null, AGORA)).toThrow(ContractNotActiveError);
  });

  it('cancela antes do fim previsto', () => {
    const contrato = rascunho();
    contrato.activate(AGORA);
    contrato.cancel('cliente desistiu', AGORA);

    expect(contrato.status).toBe('canceled');
    expect(contrato.closedAt).not.toBeNull();
  });
});

describe('situação derivada', () => {
  it('vigência encerrada aparece como expired sem job nenhum', () => {
    // Se `expired` fosse coluna, o contrato ficaria "ativo" até um job passar
    // — e é dessa janela que saem cobranças fora de vigência.
    const contrato = rascunho();
    contrato.activate(AGORA);

    expect(contrato.situacao(new Date('2026-10-01T00:00:00.000Z'))).toBe(
      'active',
    );
    expect(contrato.situacao(DEPOIS_DO_FIM)).toBe('expired');
    // O estado guardado não muda sozinho.
    expect(contrato.status).toBe('active');
  });

  it('rascunho não expira — vigência só conta para o que foi ativado', () => {
    expect(rascunho().situacao(DEPOIS_DO_FIM)).toBe('draft');
  });

  it('encerrar formalmente o que já venceu é legítimo', () => {
    // É assim que a situação para de ser `expired` e vira `finished`.
    const contrato = rascunho();
    contrato.activate(AGORA);
    contrato.finish('vigência cumprida', DEPOIS_DO_FIM);

    expect(contrato.situacao(DEPOIS_DO_FIM)).toBe('finished');
  });

  it('contrato encerrado não está em vigor', () => {
    const contrato = rascunho();
    contrato.activate(AGORA);
    contrato.finish(null, AGORA);
    expect(contrato.emVigor(new Date('2026-10-01T00:00:00.000Z'))).toBe(false);
  });
});
