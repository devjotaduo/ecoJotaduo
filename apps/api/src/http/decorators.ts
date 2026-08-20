import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'movimentar:public';
export const PERMISSIONS_KEY = 'movimentar:permissions';

/** Marca a rota como aberta (login, health). Tudo o mais exige token. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Permissões exigidas pela rota. O guard aplica a cadeia completa:
 * módulo contratado → papel (RBAC) → escopo do token.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
