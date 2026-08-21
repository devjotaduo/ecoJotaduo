import { describe, expect, it } from 'vitest';

import { Asset, disponibilidade } from '../src/domain/asset';
import {
  AssetRetiredError,
  HoldAlreadyReleasedError,
  InvalidAssetPeriodError,
} from '../src/domain/errors';
import { AssetHold } from '../src/domain/hold';
import { Periodo } from '../src/domain/periodo';

const T = (iso: string) => new Date(iso);

function bloqueio(inicio: string, fim: string) {
  return AssetHold.abrir({
    id: 'h-1',
    tenantId: 't-1',
    assetId: 'a-1',
    reason: 'reserved',
    periodo: Periodo.de(T(inicio), T(fim)),
    agora: T('2026-01-01T00:00:00Z'),
  });
}

function ativo() {
  return Asset.register({
    id: 'a-1',
    tenantId: 't-1',
    code: 'ESC-014',
    name: 'Escavadeira 20t',
    category: 'escavadeira',
    agora: T('2026-01-01T00:00:00Z'),
  });
}

describe('Periodo', () => {
  it('recusa fim antes ou igual ao início', () => {
    expect(() =>
      Periodo.de(T('2026-03-10T08:00:00Z'), T('2026-03-10T08:00:00Z')),
    ).toThrow(InvalidAssetPeriodError);
    expect(() =>
      Periodo.de(T('2026-03-10T09:00:00Z'), T('2026-03-10T08:00:00Z')),
    ).toThrow(InvalidAssetPeriodError);
  });

  it('detecta sobreposição parcial nos dois sentidos', () => {
    const manha = Periodo.de(
      T('2026-03-10T08:00:00Z'),
      T('2026-03-10T12:00:00Z'),
    );
    const meio = Periodo.de(
      T('2026-03-10T10:00:00Z'),
      T('2026-03-10T14:00:00Z'),
    );

    expect(manha.sobrepoe(meio)).toBe(true);
    expect(meio.sobrepoe(manha)).toBe(true);
  });

  it('encostar NÃO é sobrepor — a borda do fim é aberta', () => {
    // Sem isto, devolver o equipamento às 12h e entregá-lo a outro cliente às
    // 12h seria um conflito, e todo encadeamento normal viraria erro.
    const manha = Periodo.de(
      T('2026-03-10T08:00:00Z'),
      T('2026-03-10T12:00:00Z'),
    );
    const tarde = Periodo.de(
      T('2026-03-10T12:00:00Z'),
      T('2026-03-10T18:00:00Z'),
    );

    expect(manha.sobrepoe(tarde)).toBe(false);
    expect(manha.contem(T('2026-03-10T12:00:00Z'))).toBe(false);
    expect(manha.contem(T('2026-03-10T08:00:00Z'))).toBe(true);
  });

  it('encerrar antecipa o fim, e nunca o estende', () => {
    const periodo = Periodo.de(
      T('2026-03-10T08:00:00Z'),
      T('2026-03-20T08:00:00Z'),
    );

    expect(periodo.encerradoEm(T('2026-03-12T08:00:00Z')).fim).toEqual(
      T('2026-03-12T08:00:00Z'),
    );
    // Depois do fim previsto não muda nada: o bloqueio já tinha acabado.
    expect(periodo.encerradoEm(T('2026-04-01T08:00:00Z')).fim).toEqual(
      T('2026-03-20T08:00:00Z'),
    );
  });

  it('encerrar antes do início zera o período em vez de invertê-lo', () => {
    const futuro = Periodo.de(
      T('2026-05-01T00:00:00Z'),
      T('2026-05-10T00:00:00Z'),
    );
    const cancelado = futuro.encerradoEm(T('2026-04-01T00:00:00Z'));

    expect(cancelado.vazio).toBe(true);
    // Período vazio não disputa nada — é o que tira o bloqueio do caminho.
    expect(cancelado.sobrepoe(futuro)).toBe(false);
  });
});

describe('AssetHold', () => {
  it('vigente dentro do período, livre fora dele', () => {
    const reserva = bloqueio('2026-03-10T08:00:00Z', '2026-03-20T08:00:00Z');

    expect(reserva.vigenteEm(T('2026-03-15T00:00:00Z'))).toBe(true);
    expect(reserva.vigenteEm(T('2026-03-01T00:00:00Z'))).toBe(false);
    expect(reserva.vigenteEm(T('2026-04-01T00:00:00Z'))).toBe(false);
  });

  it('liberar encurta o período efetivo sem apagar o combinado', () => {
    const reserva = bloqueio('2026-03-10T08:00:00Z', '2026-03-20T08:00:00Z');
    reserva.release(T('2026-03-12T10:00:00Z'));

    expect(reserva.endsAt).toEqual(T('2026-03-20T08:00:00Z'));
    expect(reserva.periodoEfetivo.fim).toEqual(T('2026-03-12T10:00:00Z'));
    expect(reserva.vigenteEm(T('2026-03-15T00:00:00Z'))).toBe(false);
  });

  it('liberar antes de começar tira o bloqueio inteiro do caminho', () => {
    const futuro = bloqueio('2026-05-01T00:00:00Z', '2026-05-10T00:00:00Z');
    futuro.release(T('2026-04-01T00:00:00Z'));

    expect(futuro.periodoEfetivo.vazio).toBe(true);
    expect(futuro.aberto(T('2026-04-02T00:00:00Z'))).toBe(false);
  });

  it('liberar duas vezes é recusado', () => {
    const reserva = bloqueio('2026-03-10T08:00:00Z', '2026-03-20T08:00:00Z');
    reserva.release(T('2026-03-12T10:00:00Z'));

    expect(() => reserva.release(T('2026-03-13T10:00:00Z'))).toThrow(
      HoldAlreadyReleasedError,
    );
  });

  it('bloqueio já vencido não está aberto', () => {
    const antigo = bloqueio('2026-01-05T00:00:00Z', '2026-01-10T00:00:00Z');
    expect(antigo.aberto(T('2026-02-01T00:00:00Z'))).toBe(false);
  });
});

describe('Asset', () => {
  it('nasce ativo e com os textos aparados', () => {
    const novo = Asset.register({
      id: 'a-2',
      tenantId: 't-1',
      code: '  ESC-015  ',
      name: '  Escavadeira 30t ',
      category: ' escavadeira ',
      serialNumber: '   ',
      agora: T('2026-01-01T00:00:00Z'),
    });

    expect(novo.code).toBe('ESC-015');
    expect(novo.name).toBe('Escavadeira 30t');
    expect(novo.status).toBe('active');
    // Série em branco é ausência de série, não string vazia.
    expect(novo.serialNumber).toBeNull();
  });

  it('baixa registra motivo e instante', () => {
    const maquina = ativo();
    maquina.retire('vendida em leilão', T('2026-06-01T00:00:00Z'));

    expect(maquina.status).toBe('retired');
    expect(maquina.retiredAt).toEqual(T('2026-06-01T00:00:00Z'));
    expect(maquina.retireReason).toBe('vendida em leilão');
  });

  it('ativo baixado não recebe correção, bloqueio nem nova baixa', () => {
    const maquina = ativo();
    maquina.retire(null);

    expect(() => maquina.update({ name: 'outro nome' })).toThrow(
      AssetRetiredError,
    );
    expect(() => maquina.exigirEmOperacao()).toThrow(AssetRetiredError);
    expect(() => maquina.retire(null)).toThrow(AssetRetiredError);
  });

  it('atualizar preserva o que não foi informado', () => {
    const maquina = ativo();
    maquina.update({ name: 'Escavadeira 20t (revisada)' });

    expect(maquina.name).toBe('Escavadeira 20t (revisada)');
    expect(maquina.category).toBe('escavadeira');
    expect(maquina.code).toBe('ESC-014');
  });
});

describe('disponibilidade derivada', () => {
  it('sem bloqueio, disponível', () => {
    expect(disponibilidade(ativo(), null)).toBe('available');
  });

  it('com bloqueio vigente, preso', () => {
    expect(
      disponibilidade(
        ativo(),
        bloqueio('2026-03-10T08:00:00Z', '2026-03-20T08:00:00Z'),
      ),
    ).toBe('held');
  });

  it('baixado vence qualquer bloqueio', () => {
    const maquina = ativo();
    maquina.retire(null);
    expect(
      disponibilidade(
        maquina,
        bloqueio('2026-03-10T08:00:00Z', '2026-03-20T08:00:00Z'),
      ),
    ).toBe('retired');
  });
});
