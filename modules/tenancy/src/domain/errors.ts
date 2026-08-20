export class TenantNotFoundError extends Error {
  constructor(identificador: string) {
    super(`Tenant não encontrado: "${identificador}".`);
    this.name = 'TenantNotFoundError';
  }
}

export class TenantNotActiveError extends Error {
  constructor() {
    super('Tenant inativo ou suspenso.');
    this.name = 'TenantNotActiveError';
  }
}

/**
 * Usuário existe e a senha confere, mas ele não tem vínculo ativo com o
 * tenant pedido. Mensagem propositalmente genérica: não confirma para um
 * estranho se determinada empresa usa a plataforma.
 */
export class NoActiveMembershipError extends Error {
  constructor() {
    super('Usuário sem acesso a esta empresa.');
    this.name = 'NoActiveMembershipError';
  }
}

export class ModuleAlreadyEntitledError extends Error {
  constructor(moduleId: string) {
    super(`O módulo "${moduleId}" já está ativo para este tenant.`);
    this.name = 'ModuleAlreadyEntitledError';
  }
}

export class UnknownModuleError extends Error {
  constructor(moduleId: string) {
    super(`Módulo desconhecido: "${moduleId}".`);
    this.name = 'UnknownModuleError';
  }
}
