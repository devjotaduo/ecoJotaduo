import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validação de entrada na borda HTTP. Nada entra na camada de aplicação sem
 * passar por um schema — inclusive tipos e limites de tamanho.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(valor: unknown): T {
    const resultado = this.schema.safeParse(valor);
    if (!resultado.success) {
      throw new BadRequestException(
        resultado.error.issues.map(
          (issue) => `${issue.path.join('.') || '(corpo)'}: ${issue.message}`,
        ),
      );
    }
    return resultado.data;
  }
}
