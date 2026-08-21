import { describe, expect, it } from 'vitest';

import { data, dinheiro, emCentavos, situacao } from './formato';

describe('dinheiro', () => {
  it('formata centavos como moeda brasileira', () => {
    // A API fala em CENTAVOS; a divisão por 100 acontece só aqui.
    // O Intl separa símbolo e número com espaço não separável (U+00A0).
    const semNbsp = (valor: string) => valor.replace(/\u00A0/g, ' ');
    expect(semNbsp(dinheiro(199_990, 'BRL'))).toBe('R$ 1.999,90');
    expect(semNbsp(dinheiro(0, 'BRL'))).toBe('R$ 0,00');
  });
  it('não perde centavo em valores grandes', () => {
    // Se em algum ponto isso virasse float, o último dígito escaparia.
    expect(dinheiro(1_234_567_891, 'BRL')).toContain('12.345.678,91');
  });

  it('respeita a moeda que veio da API', () => {
    expect(dinheiro(1000, 'USD')).toContain('10,00');
  });
});

describe('emCentavos', () => {
  it('lê o que a pessoa digita no formato brasileiro', () => {
    expect(emCentavos('1.999,90')).toBe(199_990);
    expect(emCentavos('1500')).toBe(150_000);
    expect(emCentavos('0,05')).toBe(5);
  });

  it('arredonda em vez de mandar fração de centavo', () => {
    expect(emCentavos('10,999')).toBe(1100);
  });

  it('devolve NaN no que não é valor, para a tela recusar antes de enviar', () => {
    expect(Number.isNaN(emCentavos('abc'))).toBe(true);
    expect(Number.isNaN(emCentavos('-5'))).toBe(true);
    expect(Number.isNaN(emCentavos(''))).toBe(true);
  });

  it('ida e volta preserva o valor', () => {
    const centavos = emCentavos('2.345,67');
    expect(dinheiro(centavos, 'BRL')).toContain('2.345,67');
  });
});

describe('data', () => {
  it('mostra no formato brasileiro', () => {
    expect(data('2026-08-21T12:00:00.000Z')).toBe('21/08/2026');
  });
});

describe('situacao', () => {
  it('traduz o enum da API', () => {
    expect(situacao('accepted')).toBe('Aceita');
    expect(situacao('expired')).toBe('Vencida');
  });

  it('devolve a chave crua quando não conhece — melhor que vazio', () => {
    expect(situacao('estado-novo-do-servidor')).toBe('estado-novo-do-servidor');
  });
});
