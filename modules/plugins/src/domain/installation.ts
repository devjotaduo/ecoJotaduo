import type { PluginStatus } from '@ecojotaduo/plugin-sdk';

import {
  PermissaoNaoPedidaError,
  TransicaoDePluginInvalidaError,
} from './errors';

/**
 * Instalação de um plugin em UMA empresa.
 *
 * A entidade guarda a única regra que impede o erro caro deste módulo:
 * **não se habilita o que não está configurado**. Um plugin habilitado sem
 * segredo falharia na primeira chamada real — e falharia dentro de um fluxo
 * de negócio, não no momento em que alguém clicou "habilitar".
 */

/** Transições permitidas. Fora deste mapa, o domínio recusa. */
const TRANSICOES: Readonly<Record<PluginStatus, readonly PluginStatus[]>> = {
  installed: ['configured'],
  configured: ['enabled', 'configured'],
  enabled: ['disabled'],
  disabled: ['enabled'],
};

export interface DadosDaInstalacao {
  readonly id: string;
  readonly tenantId: string;
  readonly pluginId: string;
  readonly version: string;
  readonly status: PluginStatus;
  readonly config: Readonly<Record<string, unknown>>;
  readonly grantedPermissions: readonly string[];
  readonly installedAt: Date;
  readonly updatedAt: Date;
}

export class PluginInstallation {
  private constructor(private dados: DadosDaInstalacao) {}

  static restore(dados: DadosDaInstalacao): PluginInstallation {
    return new PluginInstallation(dados);
  }

  static install(entrada: {
    id: string;
    tenantId: string;
    pluginId: string;
    version: string;
    /** Já validado contra o manifesto por `assertPermissoesPedidas`. */
    grantedPermissions: readonly string[];
    agora?: Date;
  }): PluginInstallation {
    const agora = entrada.agora ?? new Date();
    return new PluginInstallation({
      id: entrada.id,
      tenantId: entrada.tenantId,
      pluginId: entrada.pluginId,
      version: entrada.version,
      status: 'installed',
      config: {},
      grantedPermissions: [...entrada.grantedPermissions],
      installedAt: agora,
      updatedAt: agora,
    });
  }

  get id(): string {
    return this.dados.id;
  }
  get tenantId(): string {
    return this.dados.tenantId;
  }
  get pluginId(): string {
    return this.dados.pluginId;
  }
  get version(): string {
    return this.dados.version;
  }
  get status(): PluginStatus {
    return this.dados.status;
  }
  get config(): Readonly<Record<string, unknown>> {
    return this.dados.config;
  }
  get grantedPermissions(): readonly string[] {
    return this.dados.grantedPermissions;
  }
  get installedAt(): Date {
    return this.dados.installedAt;
  }
  get updatedAt(): Date {
    return this.dados.updatedAt;
  }
  get habilitado(): boolean {
    return this.dados.status === 'enabled';
  }

  /**
   * Reconfigurar um plugin já habilitado NÃO o derruba: trocar a URL de
   * destino é operação de rotina, e desabilitar em silêncio interromperia a
   * integração sem ninguém pedir.
   */
  configure(
    config: Readonly<Record<string, unknown>>,
    agora = new Date(),
  ): void {
    const proximo: PluginStatus =
      this.dados.status === 'installed' ? 'configured' : this.dados.status;
    this.dados = {
      ...this.dados,
      config: { ...config },
      status: proximo,
      updatedAt: agora,
    };
  }

  enable(entrada: {
    segredosExigidos: readonly string[];
    segredosPresentes: readonly string[];
    agora?: Date;
  }): void {
    this.exigirTransicao('enabled');

    const faltando = entrada.segredosExigidos.filter(
      (chave) => !entrada.segredosPresentes.includes(chave),
    );
    if (faltando.length > 0) {
      throw new TransicaoDePluginInvalidaError(
        this.dados.status,
        'enabled',
        `faltam os segredos ${faltando.join(', ')}`,
      );
    }

    this.dados = {
      ...this.dados,
      status: 'enabled',
      updatedAt: entrada.agora ?? new Date(),
    };
  }

  disable(agora = new Date()): void {
    this.exigirTransicao('disabled');
    this.dados = { ...this.dados, status: 'disabled', updatedAt: agora };
  }

  private exigirTransicao(destino: PluginStatus): void {
    if (!TRANSICOES[this.dados.status].includes(destino)) {
      throw new TransicaoDePluginInvalidaError(this.dados.status, destino);
    }
  }
}

/**
 * Só se concede o que o manifesto pede.
 *
 * Sem esta checagem, quem instala poderia dar ao plugin uma permissão que o
 * autor nunca declarou — e a revisão do manifesto deixaria de valer alguma
 * coisa como controle.
 */
export function assertPermissoesPedidas(
  pluginId: string,
  pedidas: readonly string[],
  concedidas: readonly string[],
): void {
  const extras = concedidas.filter((permissao) => !pedidas.includes(permissao));
  if (extras.length > 0) {
    throw new PermissaoNaoPedidaError(pluginId, extras);
  }
}
