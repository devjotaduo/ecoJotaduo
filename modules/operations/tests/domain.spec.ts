import { describe, expect, it } from 'vitest';

import {
  InvalidRentalPeriodError,
  RentalAlreadyStartedError,
  RentalNotActiveError,
  RentalNotScheduledError,
} from '../src/domain/errors';
import { Rental } from '../src/domain/rental';

const T = (iso: string) => new Date(iso);
const AGORA = T('2026-03-01T00:00:00Z');

function locacao(
  inicio = '2026-03-10T08:00:00Z',
  fim = '2026-03-20T08:00:00Z',
) {
  return Rental.schedule({
    id: 'r-1',
    tenantId: 't-1',
    number: 1,
    contractId: 'c-1',
    customerId: 'cli-1',
    assetId: 'a-1',
    assetCode: 'ESC-014',
    holdId: 'h-1',
    startsAt: T(inicio),
    endsAt: T(fim),
    agora: AGORA,
  });
}

describe('programação', () => {
  it('nasce programada, prendendo o equipamento', () => {
    const nova = locacao();

    expect(nova.status).toBe('scheduled');
    expect(nova.startedAt).toBeNull();
    expect(nova.prendeOEquipamento).toBe(true);
  });

  it('recusa devolução antes da retirada', () => {
    expect(() =>
      locacao('2026-03-20T08:00:00Z', '2026-03-10T08:00:00Z'),
    ).toThrow(InvalidRentalPeriodError);
  });

  it('recusa período que já teria terminado', () => {
    expect(() =>
      Rental.schedule({
        id: 'r-2',
        tenantId: 't-1',
        number: 2,
        contractId: 'c-1',
        customerId: 'cli-1',
        assetId: 'a-1',
        assetCode: 'ESC-014',
        holdId: 'h-2',
        startsAt: T('2026-01-01T00:00:00Z'),
        endsAt: T('2026-02-01T00:00:00Z'),
        agora: AGORA,
      }),
    ).toThrow(InvalidRentalPeriodError);
  });
});

describe('ciclo', () => {
  it('programada → em andamento → encerrada', () => {
    const alugada = locacao();
    alugada.start(T('2026-03-10T09:00:00Z'));
    expect(alugada.status).toBe('active');

    alugada.finish('equipamento em ordem', T('2026-03-19T17:00:00Z'));
    expect(alugada.status).toBe('finished');
    expect(alugada.closeReason).toBe('equipamento em ordem');
    // Encerrada, o equipamento não fica mais preso.
    expect(alugada.prendeOEquipamento).toBe(false);
  });

  it('não inicia duas vezes', () => {
    const alugada = locacao();
    alugada.start(T('2026-03-10T09:00:00Z'));
    expect(() => alugada.start(T('2026-03-11T09:00:00Z'))).toThrow(
      RentalNotScheduledError,
    );
  });

  it('não devolve o que ainda não saiu', () => {
    expect(() => locacao().finish(null, T('2026-03-12T00:00:00Z'))).toThrow(
      RentalNotActiveError,
    );
  });

  it('cancela enquanto o equipamento não saiu', () => {
    const alugada = locacao();
    alugada.cancel('cliente desistiu', T('2026-03-05T00:00:00Z'));

    expect(alugada.status).toBe('canceled');
    expect(alugada.prendeOEquipamento).toBe(false);
  });

  it('NÃO cancela depois que o equipamento saiu', () => {
    // Cancelar não traz a máquina de volta do canteiro do cliente; o que
    // existe nesse ponto é devolução, com data.
    const alugada = locacao();
    alugada.start(T('2026-03-10T09:00:00Z'));

    expect(() => alugada.cancel(null, T('2026-03-11T00:00:00Z'))).toThrow(
      RentalAlreadyStartedError,
    );
  });
});

describe('atraso derivado', () => {
  it('em andamento com prazo vencido aparece como atrasada', () => {
    const alugada = locacao();
    alugada.start(T('2026-03-10T09:00:00Z'));

    // Nada rodou entre as duas leituras: a mesma locação, dois instantes.
    expect(alugada.situacao(T('2026-03-15T00:00:00Z'))).toBe('active');
    expect(alugada.situacao(T('2026-03-25T00:00:00Z'))).toBe('overdue');
  });

  it('conta os dias de atraso, arredondando para cima', () => {
    const alugada = locacao();
    alugada.start(T('2026-03-10T09:00:00Z'));

    expect(alugada.diasDeAtraso(T('2026-03-19T00:00:00Z'))).toBe(0);
    // Fim previsto: 20/03 08:00. Um dia e meio depois conta como dois.
    expect(alugada.diasDeAtraso(T('2026-03-21T20:00:00Z'))).toBe(2);
  });

  it('programada não atrasa — só o que saiu pode atrasar', () => {
    expect(locacao().situacao(T('2026-04-01T00:00:00Z'))).toBe('scheduled');
    expect(locacao().diasDeAtraso(T('2026-04-01T00:00:00Z'))).toBe(0);
  });

  it('devolver uma locação ATRASADA é válido', () => {
    // Recusar deixaria o equipamento preso para sempre: a devolução é o que
    // faz a situação parar de ser `overdue`.
    const alugada = locacao();
    alugada.start(T('2026-03-10T09:00:00Z'));
    alugada.finish('devolvido com atraso', T('2026-03-25T00:00:00Z'));

    expect(alugada.status).toBe('finished');
    expect(alugada.situacao(T('2026-03-26T00:00:00Z'))).toBe('finished');
  });

  it('encerrada não volta a atrasar', () => {
    const alugada = locacao();
    alugada.start(T('2026-03-10T09:00:00Z'));
    alugada.finish(null, T('2026-03-19T00:00:00Z'));

    expect(alugada.diasDeAtraso(T('2027-01-01T00:00:00Z'))).toBe(0);
  });
});
