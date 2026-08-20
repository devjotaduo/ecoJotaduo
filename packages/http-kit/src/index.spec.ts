import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  Public,
  RequirePermissions,
  ZodValidationPipe,
} from './index';

const schema = z.object({
  nome: z.string().min(2),
  idade: z.coerce.number().int().min(0),
});

describe('ZodValidationPipe', () => {
  it('devolve o valor já convertido pelo schema', () => {
    const pipe = new ZodValidationPipe(schema);

    // A idade chega como texto (querystring) e sai número.
    expect(pipe.transform({ nome: 'Ana', idade: '33' })).toEqual({
      nome: 'Ana',
      idade: 33,
    });
  });

  it('recusa entrada inválida com 400 e lista TODAS as violações', () => {
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ nome: 'A', idade: -1 });
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(BadRequestException);
      const detalhe = (erro as BadRequestException).getResponse() as {
        message: string[];
      };
      expect(detalhe.message).toHaveLength(2);
      expect(detalhe.message.join(' ')).toContain('nome');
      expect(detalhe.message.join(' ')).toContain('idade');
    }
  });

  it('identifica o campo pelo caminho, inclusive aninhado', () => {
    const aninhado = z.object({
      endereco: z.object({ cep: z.string().length(8) }),
    });

    try {
      new ZodValidationPipe(aninhado).transform({ endereco: { cep: '123' } });
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      const detalhe = (erro as BadRequestException).getResponse() as {
        message: string[];
      };
      expect(detalhe.message[0]).toContain('endereco.cep');
    }
  });
});

describe('decorators de autorização', () => {
  it('usam chaves de metadado estáveis (o guard depende delas)', () => {
    // Mudar estas strings quebra o AccessGuard silenciosamente: toda rota
    // viraria "sem permissão exigida". Por isso ficam sob teste.
    expect(PUBLIC_KEY).toBe('ecojotaduo:public');
    expect(PERMISSIONS_KEY).toBe('ecojotaduo:permissions');
  });

  it('são funções que produzem decorators', () => {
    expect(typeof Public()).toBe('function');
    expect(typeof RequirePermissions('crm.customer.read')).toBe('function');
  });
});
