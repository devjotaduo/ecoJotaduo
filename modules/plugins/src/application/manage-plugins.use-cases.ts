import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';
import type { PluginHealth, PluginStatus } from '@ecojotaduo/plugin-sdk';

import type { PluginCatalog } from '../catalog';
import {
  ConfiguracaoInvalidaError,
  PluginJaInstaladoError,
  PluginNaoInstaladoError,
  SegredoNaoPedidoError,
} from '../domain/errors';
import {
  assertPermissoesPedidas,
  PluginInstallation,
} from '../domain/installation';
import type {
  PluginInstallationRepository,
  PluginSecretRepository,
  SecretSealer,
} from '../ports/repositories';

/**
 * Ciclo de vida da instalação de plugins, por empresa.
 *
 * Uma regra atravessa todos os casos de uso deste arquivo: **nenhum caminho
 * devolve valor de segredo**. Configurar aceita segredos; listar devolve
 * apenas as chaves presentes. Quem precisa do valor é o próprio plugin, em
 * memória, durante a chamada (ver `ResolvePluginRuntimeUseCase`).
 */

export class InstallPluginUseCase {
  constructor(
    private readonly catalogo: PluginCatalog,
    private readonly instalacoes: PluginInstallationRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    pluginId: string;
    grantedPermissions: readonly string[];
  }): Promise<PluginInstallation> {
    const definicao = this.catalogo.exigir(entrada.pluginId);

    const existente = await this.instalacoes.find(
      entrada.tenantId,
      entrada.pluginId,
    );
    if (existente) {
      throw new PluginJaInstaladoError(entrada.pluginId);
    }

    assertPermissoesPedidas(
      entrada.pluginId,
      definicao.manifest.permissions,
      entrada.grantedPermissions,
    );

    const instalacao = PluginInstallation.install({
      id: randomUUID(),
      tenantId: entrada.tenantId,
      pluginId: entrada.pluginId,
      version: definicao.manifest.version,
      grantedPermissions: entrada.grantedPermissions,
    });
    await this.instalacoes.save(instalacao);

    await this.audit.record({
      action: 'platform.plugin.installed',
      result: 'success',
      resourceType: 'plugin',
      resourceId: entrada.pluginId,
      metadata: {
        version: definicao.manifest.version,
        grantedPermissions: entrada.grantedPermissions,
      },
    });

    return instalacao;
  }
}

export class ConfigurePluginUseCase {
  constructor(
    private readonly catalogo: PluginCatalog,
    private readonly instalacoes: PluginInstallationRepository,
    private readonly segredos: PluginSecretRepository,
    private readonly cofre: SecretSealer,
    private readonly audit: AuditLogger,
  ) {}

  async execute(entrada: {
    tenantId: string;
    pluginId: string;
    config: Record<string, unknown>;
    /** Valores em claro; saem daqui cifrados e nunca voltam. */
    secrets?: Record<string, string>;
  }): Promise<PluginInstallation> {
    const definicao = this.catalogo.exigir(entrada.pluginId);
    const instalacao = await this.exigirInstalacao(
      entrada.tenantId,
      entrada.pluginId,
    );

    const validacao = definicao.configSchema.safeParse(entrada.config);
    if (!validacao.success) {
      throw new ConfiguracaoInvalidaError(
        entrada.pluginId,
        validacao.error.issues.map(
          (issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
        ),
      );
    }

    for (const [chave, valor] of Object.entries(entrada.secrets ?? {})) {
      if (!definicao.manifest.requiredSecrets.includes(chave)) {
        // Aceitar chave desconhecida guardaria credencial que nada lê — lixo
        // sensível parado no banco.
        throw new SegredoNaoPedidoError(entrada.pluginId, chave);
      }
      const dono = {
        tenantId: entrada.tenantId,
        pluginId: entrada.pluginId,
        key: chave,
      };
      await this.segredos.put({
        ...dono,
        sealedValue: this.cofre.seal(valor, dono),
      });
    }

    instalacao.configure(validacao.data as Record<string, unknown>);
    await this.instalacoes.save(instalacao);

    await this.audit.record({
      action: 'platform.plugin.configured',
      result: 'success',
      resourceType: 'plugin',
      resourceId: entrada.pluginId,
      // Só as CHAVES: valor de segredo não entra em trilha de auditoria.
      metadata: { secretKeys: Object.keys(entrada.secrets ?? {}) },
    });

    return instalacao;
  }

  private async exigirInstalacao(
    tenantId: string,
    pluginId: string,
  ): Promise<PluginInstallation> {
    const instalacao = await this.instalacoes.find(tenantId, pluginId);
    if (!instalacao) {
      throw new PluginNaoInstaladoError(pluginId);
    }
    return instalacao;
  }
}

export class ChangePluginStatusUseCase {
  constructor(
    private readonly catalogo: PluginCatalog,
    private readonly instalacoes: PluginInstallationRepository,
    private readonly segredos: PluginSecretRepository,
    private readonly audit: AuditLogger,
  ) {}

  async enable(entrada: {
    tenantId: string;
    pluginId: string;
  }): Promise<PluginInstallation> {
    const definicao = this.catalogo.exigir(entrada.pluginId);
    const instalacao = await this.exigir(entrada.tenantId, entrada.pluginId);

    instalacao.enable({
      segredosExigidos: definicao.manifest.requiredSecrets,
      segredosPresentes: await this.segredos.listKeys(
        entrada.tenantId,
        entrada.pluginId,
      ),
    });
    await this.instalacoes.save(instalacao);
    await this.registrar('platform.plugin.enabled', entrada.pluginId);
    return instalacao;
  }

  async disable(entrada: {
    tenantId: string;
    pluginId: string;
  }): Promise<PluginInstallation> {
    const instalacao = await this.exigir(entrada.tenantId, entrada.pluginId);
    instalacao.disable();
    await this.instalacoes.save(instalacao);
    await this.registrar('platform.plugin.disabled', entrada.pluginId);
    return instalacao;
  }

  async uninstall(entrada: {
    tenantId: string;
    pluginId: string;
  }): Promise<void> {
    await this.exigir(entrada.tenantId, entrada.pluginId);
    // Segredos primeiro: se a remoção falhar no meio, sobra instalação sem
    // credencial (inofensivo) em vez de credencial órfã sem dono.
    await this.segredos.removeAll(entrada.tenantId, entrada.pluginId);
    await this.instalacoes.remove(entrada.tenantId, entrada.pluginId);
    await this.registrar('platform.plugin.uninstalled', entrada.pluginId);
  }

  private async exigir(
    tenantId: string,
    pluginId: string,
  ): Promise<PluginInstallation> {
    const instalacao = await this.instalacoes.find(tenantId, pluginId);
    if (!instalacao) {
      throw new PluginNaoInstaladoError(pluginId);
    }
    return instalacao;
  }

  private registrar(action: string, pluginId: string): Promise<void> {
    return this.audit.record({
      action,
      result: 'success',
      resourceType: 'plugin',
      resourceId: pluginId,
    });
  }
}

export interface PluginNoCatalogo {
  readonly pluginId: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly publisher: string;
  readonly type: string;
  readonly requestedPermissions: readonly string[];
  readonly requiredSecrets: readonly string[];
  readonly installation: {
    readonly status: PluginStatus;
    readonly version: string;
    readonly config: Readonly<Record<string, unknown>>;
    readonly grantedPermissions: readonly string[];
    /** Chaves configuradas — nunca os valores. */
    readonly configuredSecrets: readonly string[];
    readonly installedAt: Date;
    readonly updatedAt: Date;
    readonly health: PluginHealth | null;
  } | null;
}

/**
 * O catálogo com o estado da empresa — o que um painel de administração
 * mostra. Traz o diagnóstico de saúde junto porque "habilitado" e
 * "funcionando" não são a mesma coisa.
 */
export class ListPluginsUseCase {
  constructor(
    private readonly catalogo: PluginCatalog,
    private readonly instalacoes: PluginInstallationRepository,
    private readonly segredos: PluginSecretRepository,
    private readonly saude: {
      verificar(
        tenantId: string,
        pluginId: string,
      ): Promise<PluginHealth | null>;
    },
  ) {}

  async execute(entrada: { tenantId: string }): Promise<PluginNoCatalogo[]> {
    const instaladas = new Map(
      (await this.instalacoes.list(entrada.tenantId)).map((instalacao) => [
        instalacao.pluginId,
        instalacao,
      ]),
    );

    return Promise.all(
      this.catalogo
        .list()
        .map(async ({ manifest }): Promise<PluginNoCatalogo> => {
          const instalacao = instaladas.get(manifest.id);
          return {
            pluginId: manifest.id,
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
            publisher: manifest.publisher,
            type: manifest.type,
            requestedPermissions: manifest.permissions,
            requiredSecrets: manifest.requiredSecrets,
            installation: instalacao
              ? {
                  status: instalacao.status,
                  version: instalacao.version,
                  config: instalacao.config,
                  grantedPermissions: instalacao.grantedPermissions,
                  configuredSecrets: await this.segredos.listKeys(
                    entrada.tenantId,
                    manifest.id,
                  ),
                  installedAt: instalacao.installedAt,
                  updatedAt: instalacao.updatedAt,
                  health: instalacao.habilitado
                    ? await this.saude.verificar(entrada.tenantId, manifest.id)
                    : null,
                }
              : null,
          };
        }),
    );
  }
}
