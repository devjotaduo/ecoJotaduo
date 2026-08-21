import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';

/**
 * Erros de domínio do registry de plugins. Cada um declara o TIPO de problema;
 * a borda traduz para status HTTP ou para o formato de erro do MCP.
 */

export class PluginDesconhecidoError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(pluginId: string) {
    super(`O plugin "${pluginId}" não existe no catálogo desta instalação.`);
  }
}

export class PluginNaoInstaladoError extends DomainError {
  readonly kind: ProblemKind = 'not-found';
  constructor(pluginId: string) {
    super(`O plugin "${pluginId}" não está instalado nesta empresa.`);
  }
}

export class PluginJaInstaladoError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(pluginId: string) {
    super(`O plugin "${pluginId}" já está instalado nesta empresa.`);
  }
}

export class PermissaoNaoPedidaError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(pluginId: string, permissoes: readonly string[]) {
    super(
      `O plugin "${pluginId}" não pede ${permissoes.join(', ')} no manifesto; ` +
        'só é possível conceder o que foi pedido.',
    );
  }
}

export class ConfiguracaoInvalidaError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(
    pluginId: string,
    readonly violacoes: readonly string[],
  ) {
    super(
      `Configuração inválida para o plugin "${pluginId}": ${violacoes.join('; ')}.`,
    );
  }
}

export class SegredoNaoPedidoError extends DomainError {
  readonly kind: ProblemKind = 'invalid-request';
  constructor(pluginId: string, chave: string) {
    super(`O plugin "${pluginId}" não usa o segredo "${chave}".`);
  }
}

export class TransicaoDePluginInvalidaError extends DomainError {
  readonly kind: ProblemKind = 'conflict';
  constructor(de: string, para: string, motivo?: string) {
    super(
      `Não é possível ir de "${de}" para "${para}"${motivo ? `: ${motivo}` : '.'}`,
    );
  }
}

export class PluginDesabilitadoError extends DomainError {
  readonly kind: ProblemKind = 'forbidden';
  constructor(pluginId: string) {
    super(
      `O plugin "${pluginId}" não está habilitado nesta empresa. Habilite-o antes de usar suas capacidades.`,
    );
  }
}
