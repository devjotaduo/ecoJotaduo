import { describe, expect, it } from 'vitest';

import {
  DiscountExceedsSubtotalError,
  EmptyProposalError,
  InvalidMoneyError,
  InvalidProposalItemError,
  InvalidValidityError,
  MixedCurrencyError,
  Money,
  Proposal,
  ProposalExpiredError,
  ProposalItem,
  ProposalNotDecidableError,
  ProposalNotEditableError,
} from '../src/index';

const AGORA = new Date('2026-08-20T12:00:00.000Z');
const DAQUI_A_UMA_SEMANA = new Date('2026-08-27T12:00:00.000Z');
const DEPOIS_DO_VENCIMENTO = new Date('2026-08-28T12:00:00.000Z');

function rascunho(validUntil = DAQUI_A_UMA_SEMANA) {
  return Proposal.create({
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    customerId: '33333333-3333-4333-8333-333333333333',
    number: 1,
    title: 'Locação de equipamentos',
    currency: 'BRL',
    validUntil,
    agora: AGORA,
  });
}

function item(
  parcial: Partial<Parameters<typeof ProposalItem.create>[0]> = {},
) {
  return ProposalItem.create({
    id: '44444444-4444-4444-8444-444444444444',
    description: 'Escavadeira 20t — diária',
    quantity: 3,
    unitPriceCents: 150_000,
    currency: 'BRL',
    ...parcial,
  });
}

describe('Money', () => {
  it('soma e multiplica em centavos, sem ponto flutuante', () => {
    // 0.1 + 0.2 em float dá 0.30000000000000004; em centavos, dá 30.
    const soma = Money.of(10, 'BRL').plus(Money.of(20, 'BRL'));
    expect(soma.cents).toBe(30);
    expect(Money.of(150_000, 'BRL').times(3).cents).toBe(450_000);
  });

  it('recusa valor fracionário', () => {
    expect(() => Money.of(10.5, 'BRL')).toThrow(InvalidMoneyError);
  });

  it('recusa moeda fora do ISO 4217', () => {
    expect(() => Money.of(100, 'reais')).toThrow(InvalidMoneyError);
    expect(() => Money.of(100, 'br')).toThrow(InvalidMoneyError);
  });

  it('recusa somar moedas diferentes em vez de devolver número sem sentido', () => {
    expect(() => Money.of(100, 'BRL').plus(Money.of(100, 'USD'))).toThrow(
      MixedCurrencyError,
    );
  });
});

describe('item da proposta', () => {
  it('calcula o total a partir de preço, quantidade e desconto', () => {
    expect(item({ discountCents: 50_000 }).total.cents).toBe(400_000);
  });

  it('recusa desconto maior que o subtotal', () => {
    // Sem isto, a proposta fecharia com total negativo.
    expect(() => item({ quantity: 1, discountCents: 200_000 })).toThrow(
      DiscountExceedsSubtotalError,
    );
  });

  it('recusa quantidade zero ou fracionária', () => {
    expect(() => item({ quantity: 0 })).toThrow(InvalidProposalItemError);
    expect(() => item({ quantity: 1.5 })).toThrow(InvalidProposalItemError);
  });

  it('recusa preço negativo', () => {
    expect(() => item({ unitPriceCents: -1 })).toThrow(
      InvalidProposalItemError,
    );
  });
});

describe('ciclo da proposta', () => {
  it('nasce em rascunho, sem itens e com total zero', () => {
    const proposta = rascunho();
    expect(proposta.status).toBe('draft');
    expect(proposta.total.cents).toBe(0);
    expect(proposta.total.currency).toBe('BRL');
  });

  it('recusa validade no passado', () => {
    expect(() => rascunho(new Date('2026-08-19T12:00:00.000Z'))).toThrow(
      InvalidValidityError,
    );
  });

  it('soma os itens no total, sempre calculado', () => {
    // O total nunca vem da entrada: aceitar um total informado seria deixar
    // o cliente escolher quanto vai pagar.
    const proposta = rascunho();
    proposta.replaceItems([
      item(),
      item({
        id: '55555555-5555-4555-8555-555555555555',
        quantity: 1,
        unitPriceCents: 25_000,
      }),
    ]);
    expect(proposta.total.cents).toBe(475_000);
  });

  it('não envia proposta vazia', () => {
    expect(() => rascunho().send(AGORA)).toThrow(EmptyProposalError);
  });

  it('envia e congela: itens não mudam mais', () => {
    const proposta = rascunho();
    proposta.replaceItems([item()]);
    proposta.send(AGORA);

    expect(proposta.status).toBe('sent');
    // Uma proposta enviada é o documento que o cliente recebeu; alterar valor
    // depois seria mudar o combinado sem que ele soubesse.
    expect(() => proposta.replaceItems([])).toThrow(ProposalNotEditableError);
    expect(() => proposta.atualizarCabecalho({ title: 'outro' })).toThrow(
      ProposalNotEditableError,
    );
  });

  it('só decide o que foi enviado', () => {
    const proposta = rascunho();
    expect(() => proposta.accept(AGORA)).toThrow(ProposalNotDecidableError);
  });

  it('aceita dentro da validade', () => {
    const proposta = rascunho();
    proposta.replaceItems([item()]);
    proposta.send(AGORA);
    proposta.accept(new Date('2026-08-25T12:00:00.000Z'));

    expect(proposta.status).toBe('accepted');
    expect(proposta.decidedAt).not.toBeNull();
  });

  it('não aceita proposta vencida', () => {
    // Aceitar vencida é assumir preço que já não vale.
    const proposta = rascunho();
    proposta.replaceItems([item()]);
    proposta.send(AGORA);

    expect(() => proposta.accept(DEPOIS_DO_VENCIMENTO)).toThrow(
      ProposalExpiredError,
    );
  });

  it('vencimento é DERIVADO da validade, não um estado guardado', () => {
    // Se fosse coluna, dependeria de um job rodar para virar verdade — e a
    // proposta ficaria "enviada" até lá.
    const proposta = rascunho();
    proposta.replaceItems([item()]);
    proposta.send(AGORA);

    expect(proposta.status).toBe('sent');
    expect(proposta.situacao(AGORA)).toBe('sent');
    expect(proposta.situacao(DEPOIS_DO_VENCIMENTO)).toBe('expired');
    // O estado guardado não muda sozinho.
    expect(proposta.status).toBe('sent');
  });

  it('decidida é final', () => {
    const proposta = rascunho();
    proposta.replaceItems([item()]);
    proposta.send(AGORA);
    proposta.reject(AGORA);

    expect(() => proposta.accept(AGORA)).toThrow(ProposalNotDecidableError);
  });

  it('rascunho não vence — vencimento só faz sentido para o que foi enviado', () => {
    const proposta = rascunho();
    expect(proposta.situacao(DEPOIS_DO_VENCIMENTO)).toBe('draft');
  });

  it('recusa item de outra moeda no agregado', () => {
    const proposta = rascunho();
    expect(() => proposta.replaceItems([item({ currency: 'USD' })])).toThrow(
      MixedCurrencyError,
    );
  });
});
