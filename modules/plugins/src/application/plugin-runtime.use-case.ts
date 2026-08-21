import {
  SegredoAusenteError,
  type PluginHealth,
  type PluginRuntime,
} from '@ecojotaduo/plugin-sdk';

import type { PluginCatalog } from '../catalog';
import {
  PluginDesabilitadoError,
  PluginNaoInstaladoError,
} from '../domain/errors';
import type {
  PluginInstallationRepository,
  PluginSecretRepository,
  SecretSealer,
} from '../ports/repositories';

/**
 * Entrega ao plugin o que ele precisa para UMA chamada: configuração da
 * empresa, segredos abertos em memória e o acesso efetivo.
 *
 * Três recusas acontecem aqui, e todas importam:
 *
 * 1. plugin não instalado → não existe para esta empresa;
 * 2. instalado mas não habilitado → capacidade fica inerte, que é exatamente
 *    o que "desabilitar" precisa significar;
 * 3. segredo exigido ausente → erro claro, em vez de assinatura vazia
 *    seguindo adiante.
 *
 * O acesso do plugin é a INTERSEÇÃO entre o que foi concedido na instalação e
 * os módulos que a empresa mantém contratados. Cancelar o CRM corta o acesso
 * do plugin ao CRM na hora, sem reinstalar nem revisar concessão.
 */
export class ResolvePluginRuntimeUseCase {
  constructor(
    private readonly catalogo: PluginCatalog,
    private readonly instalacoes: PluginInstallationRepository,
    private readonly segredos: PluginSecretRepository,
    private readonly cofre: SecretSealer,
  ) {}

  async execute(entrada: {
    tenantId: string;
    pluginId: string;
    actorId: string;
    entitlements: readonly string[];
  }): Promise<PluginRuntime> {
    const definicao = this.catalogo.exigir(entrada.pluginId);
    const instalacao = await this.instalacoes.find(
      entrada.tenantId,
      entrada.pluginId,
    );
    if (!instalacao) {
      throw new PluginNaoInstaladoError(entrada.pluginId);
    }
    if (!instalacao.habilitado) {
      throw new PluginDesabilitadoError(entrada.pluginId);
    }

    const abertos = new Map<string, string>();
    for (const chave of definicao.manifest.requiredSecrets) {
      const dono = {
        tenantId: entrada.tenantId,
        pluginId: entrada.pluginId,
        key: chave,
      };
      const selado = await this.segredos.findSealed(
        dono.tenantId,
        dono.pluginId,
        dono.key,
      );
      if (!selado) {
        throw new SegredoAusenteError(entrada.pluginId, chave);
      }
      abertos.set(chave, this.cofre.open(selado, dono));
    }

    return {
      pluginId: entrada.pluginId,
      tenantId: entrada.tenantId,
      actorId: entrada.actorId,
      config: instalacao.config,
      grant: {
        permissions: instalacao.grantedPermissions,
        scopes: instalacao.grantedPermissions,
        entitlements: entrada.entitlements,
      },
      segredo: (chave) => {
        const valor = abertos.get(chave);
        if (valor === undefined) {
          throw new SegredoAusenteError(entrada.pluginId, chave);
        }
        return valor;
      },
    };
  }

  /** Diagnóstico da instalação, delegado ao próprio plugin. */
  async verificarSaude(
    tenantId: string,
    pluginId: string,
  ): Promise<PluginHealth | null> {
    const definicao = this.catalogo.exigir(pluginId);
    if (!definicao.verificarSaude) {
      return null;
    }
    try {
      const runtime = await this.execute({
        tenantId,
        pluginId,
        actorId: 'system',
        entitlements: [],
      });
      return await definicao.verificarSaude(runtime);
    } catch (erro) {
      // Health check nunca derruba a listagem: o painel precisa mostrar o
      // plugin quebrado, não sumir com a página inteira por causa dele.
      return {
        status: 'unavailable',
        detail: erro instanceof Error ? erro.message : 'Falha ao diagnosticar.',
      };
    }
  }
}

/**
 * Plugins habilitados de uma empresa, no formato de entitlement.
 *
 * É por aqui que "habilitar um plugin" vira autorização de verdade: o id
 * entra no grant e a cadeia existente (`AccessGuard`, catálogo MCP) passa a
 * enxergar as capacidades. Desabilitar remove o entitlement e a capacidade
 * some das duas bordas de uma vez, sem código novo em nenhuma delas.
 */
export class ListEnabledPluginsUseCase {
  constructor(private readonly instalacoes: PluginInstallationRepository) {}

  execute(tenantId: string): Promise<string[]> {
    return this.instalacoes.listEnabledIds(tenantId);
  }
}
