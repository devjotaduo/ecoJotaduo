import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Tipo do schema aceito no documento.
 *
 * O `SchemaObject` do `@nestjs/swagger` não é exportado (o `exports` do pacote
 * só expõe a raiz), então o tipo é extraído da própria assinatura pública:
 * das opções aceitas por `ApiQuery`, pega-se a variante que carrega `schema`.
 * Assim não há import profundo nem risco de divergir da versão instalada.
 */
type SchemaDoDocumento = Extract<
  Parameters<typeof ApiQuery>[0],
  { schema: unknown }
>['schema'];

/**
 * Documentação OpenAPI a partir dos MESMOS schemas Zod que validam a entrada.
 *
 * Sem isto haveria duas verdades: o schema que valida e o decorator que
 * documenta — e eles divergem no primeiro campo novo. Aqui o contrato
 * publicado é derivado da validação, então não tem como mentir.
 *
 * Funciona porque a plataforma emite OpenAPI 3.1, cujo dialeto de schema é o
 * JSON Schema 2020-12 que o `z.toJSONSchema` produz (ver ADR-0008).
 */

/** Converte Zod para o schema do documento, removendo o que o OpenAPI não usa. */
export function schemaDeZod(
  schema: z.ZodType,
  io: 'input' | 'output' = 'input',
): SchemaDoDocumento {
  const gerado = z.toJSONSchema(schema, {
    io,
    target: 'draft-2020-12',
  }) as Record<string, unknown>;
  // `$schema` é metadado do documento JSON Schema; dentro do OpenAPI é ruído.
  delete gerado.$schema;
  return gerado;
}

export function ApiZodBody(schema: z.ZodType): MethodDecorator {
  return ApiBody({ schema: schemaDeZod(schema, 'input') });
}

/**
 * Query string: o OpenAPI descreve um parâmetro por campo, não um objeto.
 * Campos com `.default()` viram opcionais no contrato publicado.
 */
export function ApiZodQuery(schema: z.ZodObject): MethodDecorator {
  const documentado = schemaDeZod(schema, 'input') as SchemaDoDocumento & {
    properties?: Record<string, SchemaDoDocumento>;
    required?: string[];
  };
  const obrigatorios = new Set(documentado.required ?? []);

  const decorators = Object.entries(documentado.properties ?? {}).map(
    ([nome, propriedade]) =>
      ApiQuery({
        name: nome,
        required: obrigatorios.has(nome),
        schema: propriedade,
      }),
  );

  return applyDecorators(...decorators);
}

export function ApiZodResponse(
  status: number,
  schema: z.ZodType,
  description: string,
): MethodDecorator {
  return ApiResponse({
    status,
    description,
    schema: schemaDeZod(schema, 'output'),
  });
}

/** Envelope de página, reaproveitado por todas as listagens. */
export function paginado<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  });
}

/** Problem Details (RFC 9457) — a forma de TODO erro da API. */
export const problemaSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string(),
  correlationId: z.string().optional(),
  errors: z.array(z.string()).optional(),
});

/** Respostas de erro que qualquer rota autenticada pode devolver. */
export function ApiErrosPadrao(): MethodDecorator {
  return applyDecorators(
    ApiZodResponse(401, problemaSchema, 'Não autenticado ou sessão expirada.'),
    ApiZodResponse(
      403,
      problemaSchema,
      'Sem permissão, ou módulo não contratado pela empresa.',
    ),
  );
}
