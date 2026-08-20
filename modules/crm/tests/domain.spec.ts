import { describe, expect, it } from 'vitest';

import { Appointment } from '../src/domain/appointment';
import { Customer } from '../src/domain/customer';
import { CustomerDocument } from '../src/domain/document';
import {
  AppointmentInThePastError,
  AppointmentNotOpenError,
  CustomerArchivedError,
  EmptyNoteError,
  InvalidAppointmentDurationError,
  InvalidCustomerNameError,
  InvalidDocumentError,
} from '../src/domain/errors';
import { CustomerNote } from '../src/domain/note';

const AGORA = new Date('2026-08-20T12:00:00Z');
const AMANHA = new Date('2026-08-21T14:00:00Z');

describe('CustomerDocument', () => {
  it('aceita CPF válido com ou sem pontuação e guarda só dígitos', () => {
    // CPF de teste com dígitos verificadores corretos.
    expect(CustomerDocument.create('529.982.247-25').digits).toBe(
      '52998224725',
    );
    expect(CustomerDocument.create('52998224725').kind).toBe('cpf');
  });

  it('aceita CNPJ válido', () => {
    expect(CustomerDocument.create('11.222.333/0001-81').digits).toBe(
      '11222333000181',
    );
    expect(CustomerDocument.create('11222333000181').kind).toBe('cnpj');
  });

  it('recusa dígito verificador errado', () => {
    expect(() => CustomerDocument.create('529.982.247-24')).toThrow(
      InvalidDocumentError,
    );
    expect(() => CustomerDocument.create('11.222.333/0001-82')).toThrow(
      InvalidDocumentError,
    );
  });

  it('recusa sequência repetida, que passa no cálculo mas não existe', () => {
    expect(() => CustomerDocument.create('111.111.111-11')).toThrow(
      InvalidDocumentError,
    );
    expect(() => CustomerDocument.create('00000000000000')).toThrow(
      InvalidDocumentError,
    );
  });

  it('recusa tamanho inválido', () => {
    for (const invalido of ['', '123', '5299822472', '112223330001812']) {
      expect(() => CustomerDocument.create(invalido)).toThrow(
        InvalidDocumentError,
      );
    }
  });

  it('formata para exibição sem alterar o armazenado', () => {
    const cpf = CustomerDocument.create('52998224725');
    expect(cpf.format()).toBe('529.982.247-25');
    expect(cpf.digits).toBe('52998224725');

    expect(CustomerDocument.create('11222333000181').format()).toBe(
      '11.222.333/0001-81',
    );
  });
});

describe('Customer', () => {
  function cliente(nome = 'Construtora Alfa') {
    return Customer.create({ id: 'c1', name: nome, agora: AGORA });
  }

  it('normaliza nome (espaços colapsados) e e-mail (minúsculas)', () => {
    const criado = Customer.create({
      id: 'c1',
      name: '  Construtora   Alfa  ',
      email: ' Contato@Alfa.COM.br ',
      phone: '(11) 98888-7777',
      agora: AGORA,
    });

    expect(criado.name).toBe('Construtora Alfa');
    expect(criado.email).toBe('contato@alfa.com.br');
    expect(criado.phone).toBe('11988887777');
  });

  it('recusa nome curto demais ou longo demais', () => {
    expect(() => cliente('A')).toThrow(InvalidCustomerNameError);
    expect(() => cliente('x'.repeat(201))).toThrow(InvalidCustomerNameError);
  });

  it('aceita cliente sem documento (prospect ainda não qualificado)', () => {
    expect(cliente().document).toBeNull();
  });

  it('atualiza só os campos informados', () => {
    const alvo = Customer.create({
      id: 'c1',
      name: 'Alfa',
      email: 'a@alfa.com.br',
      agora: AGORA,
    });

    alvo.update({ phone: '11 3333-4444' }, AMANHA);

    expect(alvo.name).toBe('Alfa');
    expect(alvo.email).toBe('a@alfa.com.br');
    expect(alvo.phone).toBe('1133334444');
    expect(alvo.updatedAt).toEqual(AMANHA);
  });

  it('permite limpar um campo passando null explicitamente', () => {
    const alvo = Customer.create({
      id: 'c1',
      name: 'Alfa',
      email: 'a@alfa.com.br',
      agora: AGORA,
    });
    alvo.update({ email: null }, AMANHA);
    expect(alvo.email).toBeNull();
  });

  it('cliente arquivado não aceita nova interação, mas continua consultável', () => {
    const alvo = cliente();
    expect(() => alvo.assertAceitaInteracao()).not.toThrow();

    alvo.archive(AMANHA);

    expect(alvo.status).toBe('archived');
    expect(alvo.name).toBe('Construtora Alfa');
    expect(() => alvo.assertAceitaInteracao()).toThrow(CustomerArchivedError);
  });
});

describe('CustomerNote', () => {
  it('guarda o corpo sem espaços nas pontas', () => {
    const nota = CustomerNote.create({
      id: 'n1',
      customerId: 'c1',
      body: '  Cliente pediu orçamento de escavadeira  ',
      authorId: 'u1',
      agora: AGORA,
    });

    expect(nota.body).toBe('Cliente pediu orçamento de escavadeira');
    expect(nota.createdAt).toEqual(AGORA);
  });

  it('recusa nota vazia ou só com espaços', () => {
    for (const corpo of ['', '   ', '\n\t']) {
      expect(() =>
        CustomerNote.create({
          id: 'n1',
          customerId: 'c1',
          body: corpo,
          authorId: 'u1',
        }),
      ).toThrow(EmptyNoteError);
    }
  });

  it('recusa nota acima do limite', () => {
    expect(() =>
      CustomerNote.create({
        id: 'n1',
        customerId: 'c1',
        body: 'x'.repeat(5001),
        authorId: 'u1',
      }),
    ).toThrow(EmptyNoteError);
  });
});

describe('Appointment', () => {
  function agendar(
    sobrescreve: Partial<Parameters<typeof Appointment.schedule>[0]> = {},
  ) {
    return Appointment.schedule({
      id: 'a1',
      customerId: 'c1',
      title: 'Visita técnica',
      scheduledFor: AMANHA,
      durationMinutes: 60,
      assignedToId: 'u1',
      agora: AGORA,
      ...sobrescreve,
    });
  }

  it('agenda no futuro com duração válida', () => {
    const agendamento = agendar();
    expect(agendamento.status).toBe('scheduled');
    expect(agendamento.periodo.fim.toISOString()).toBe(
      '2026-08-21T15:00:00.000Z',
    );
  });

  it('recusa agendamento no passado ou no instante presente', () => {
    expect(() =>
      agendar({ scheduledFor: new Date('2026-08-20T11:59:00Z') }),
    ).toThrow(AppointmentInThePastError);
    expect(() => agendar({ scheduledFor: AGORA })).toThrow(
      AppointmentInThePastError,
    );
  });

  it('recusa duração fora dos limites ou fracionada', () => {
    for (const duracao of [0, 4, 481, 30.5]) {
      expect(() => agendar({ durationMinutes: duracao })).toThrow(
        InvalidAppointmentDurationError,
      );
    }
  });

  describe('conflito de agenda', () => {
    it('detecta sobreposição do mesmo responsável', () => {
      const primeiro = agendar();
      const sobreposto = agendar({
        id: 'a2',
        scheduledFor: new Date('2026-08-21T14:30:00Z'),
      });

      expect(primeiro.conflitaCom(sobreposto)).toBe(true);
      expect(sobreposto.conflitaCom(primeiro)).toBe(true);
    });

    it('agendamentos encostados NÃO conflitam', () => {
      const primeiro = agendar();
      const emSeguida = agendar({
        id: 'a2',
        scheduledFor: new Date('2026-08-21T15:00:00Z'),
      });

      expect(primeiro.conflitaCom(emSeguida)).toBe(false);
    });

    it('responsáveis diferentes não conflitam', () => {
      const primeiro = agendar();
      const outroResponsavel = agendar({ id: 'a2', assignedToId: 'u2' });

      expect(primeiro.conflitaCom(outroResponsavel)).toBe(false);
    });

    it('sem responsável definido não há conflito de agenda', () => {
      const semDono = agendar({ assignedToId: null });
      const outroSemDono = agendar({ id: 'a2', assignedToId: null });

      expect(semDono.conflitaCom(outroSemDono)).toBe(false);
    });

    it('agendamento cancelado libera o horário', () => {
      const primeiro = agendar();
      const sobreposto = agendar({ id: 'a2' });
      primeiro.cancel('cliente adiou', AGORA);

      expect(primeiro.conflitaCom(sobreposto)).toBe(false);
      expect(sobreposto.conflitaCom(primeiro)).toBe(false);
    });
  });

  describe('transições de estado', () => {
    it('conclui registrando o desfecho', () => {
      const agendamento = agendar();
      agendamento.complete('  Orçamento entregue  ', AMANHA);

      expect(agendamento.status).toBe('done');
      expect(agendamento.outcome).toBe('Orçamento entregue');
      expect(agendamento.updatedAt).toEqual(AMANHA);
    });

    it('cancela registrando o motivo', () => {
      const agendamento = agendar();
      agendamento.cancel('cliente cancelou', AMANHA);

      expect(agendamento.status).toBe('canceled');
      expect(agendamento.outcome).toBe('cliente cancelou');
    });

    it('não permite concluir ou cancelar duas vezes', () => {
      const concluido = agendar();
      concluido.complete(null, AMANHA);
      expect(() => concluido.complete(null, AMANHA)).toThrow(
        AppointmentNotOpenError,
      );
      expect(() => concluido.cancel(null, AMANHA)).toThrow(
        AppointmentNotOpenError,
      );

      const cancelado = agendar({ id: 'a2' });
      cancelado.cancel(null, AMANHA);
      expect(() => cancelado.complete(null, AMANHA)).toThrow(
        AppointmentNotOpenError,
      );
    });
  });
});
