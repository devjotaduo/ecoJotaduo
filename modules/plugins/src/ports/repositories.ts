import type { PluginInstallation } from '../domain/installation';

export interface PluginInstallationRepository {
  find(tenantId: string, pluginId: string): Promise<PluginInstallation | null>;
  list(tenantId: string): Promise<PluginInstallation[]>;
  /** Ids habilitados — é isto que vira entitlement no grant de acesso. */
  listEnabledIds(tenantId: string): Promise<string[]>;
  save(instalacao: PluginInstallation): Promise<void>;
  remove(tenantId: string, pluginId: string): Promise<void>;
}

export interface PluginSecretRepository {
  /** Apenas as CHAVES. Nenhum caminho de listagem devolve valor. */
  listKeys(tenantId: string, pluginId: string): Promise<string[]>;
  /** Devolve o texto cifrado; abrir é responsabilidade do `SecretSealer`. */
  findSealed(
    tenantId: string,
    pluginId: string,
    key: string,
  ): Promise<string | null>;
  put(entrada: {
    tenantId: string;
    pluginId: string;
    key: string;
    sealedValue: string;
  }): Promise<void>;
  removeAll(tenantId: string, pluginId: string): Promise<void>;
}

/** Identifica o dono do segredo — entra na autenticação da cifra. */
export interface DonoDeSegredo {
  readonly tenantId: string;
  readonly pluginId: string;
  readonly key: string;
}

/**
 * Porta de cifra dos segredos.
 *
 * Existe para manter a criptografia (e a chave-mestra) fora da camada de
 * aplicação, do mesmo jeito que `AccessTokenIssuer` faz no tenancy: o caso de
 * uso sabe *que* o valor é selado, não *como*.
 */
export interface SecretSealer {
  seal(valor: string, dono: DonoDeSegredo): string;
  open(selado: string, dono: DonoDeSegredo): string;
}
