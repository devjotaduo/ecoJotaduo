import {
  BadRequestException,
  SetMetadata,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Cola entre o NestJS e os adaptadores REST dos módulos.
 *
 * Mora em pacote próprio porque o módulo de domínio não pode importar de
 * `apps/api` (inverteria a dependência: o composition root é quem conhece os
 * módulos, não o contrário).
 */

export const PUBLIC_KEY = 'ecojotaduo:public';
export const PERMISSIONS_KEY = 'ecojotaduo:permissions';

/** Marca a rota como aberta (login, health). Tudo o mais exige token. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Permissões exigidas pela rota. O guard aplica a cadeia completa:
 * módulo contratado → papel (RBAC) → escopo do token.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

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
