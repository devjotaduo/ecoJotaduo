import { authorize, moduleOf, type AccessGrant } from '@ecojotaduo/permissions';
import { DomainError, type ProblemKind } from '@ecojotaduo/platform-kernel';
import type { z } from 'zod';

import type { PluginManifest } from './manifest';

/**
 * O que a plataforma entrega ao plugin no momento da chamada.
 *
 * Existe por chamada, nunca em variável de módulo: config e segredo são por
 * empresa, e guardá-los entre chamadas seria o caminho mais curto para servir
 * a empresa A com o segredo da B.
 */
export interface PluginRuntime<TConfig = unknown> {
  readonly pluginId: string;
  readonly tenantId: string;
  /** Quem disparou a ação (usuário ou service account). */
  readonly actorId: string;
  readonly config: TConfig;
  /**
   * Acesso EFETIVO do plugin: o que foi concedido na instalação, ainda
   * limitado pelos módulos que a empresa mantém contratados. Cancelar o CRM
   * tira o acesso do plugin ao CRM sem ninguém precisar reinstalar nada.
   */
  readonly grant: AccessGrant;
  /**
   * Segredo em claro, apenas na memória desta chamada.
   *
   * Nunca devolva o retorno disto em resposta de API, tool MCP, log ou
   * mensagem de erro — o modelo e o cliente jamais veem credencial de
   * terceiro (é regra da plataforma, não recomendação).
   */
  segredo(chave: string): string;
}

export class SegredoAusenteError extends Error {
  constructor(pluginId: string, chave: string) {
    super(
      `O plugin "${pluginId}" exige o segredo "${chave}", que não foi configurado para esta empresa.`,
    );
    this.name = 'SegredoAusenteError';
  }
}

/**
 * O plugin tentou usar algo que não lhe foi concedido.
 *
 * Estende `DomainError` (e não o `ForbiddenError` do motor) por dois motivos:
 * o autor do plugin trata os erros do SDK sem precisar conhecer o pacote de
 * permissões, e o filtro de Problem Details traduz para 403 pelo caminho
 * genérico — sem `instanceof` novo na borda, como manda o CLAUDE.md.
 */
export class PermissaoDoPluginNegadaError extends DomainError {
  readonly kind: ProblemKind = 'forbidden';
  constructor(
    readonly pluginId: string,
    readonly permissao: string,
    motivo: string,
  ) {
    super(`O plugin "${pluginId}" não pode usar "${permissao}": ${motivo}`);
  }
}

/**
 * Verifica, na chamada, uma permissão que o plugin pediu no manifesto.
 *
 * É a mesma função de decisão das outras bordas — plugin não ganha um motor
 * próprio. O que muda é só a origem do grant: a concessão da instalação, não
 * os papéis de quem chamou.
 */
export function exigirPermissaoDoPlugin(
  runtime: PluginRuntime,
  permissao: string,
): void {
  const decisao = authorize(runtime.grant, permissao);
  if (decisao.allowed) {
    return;
  }
  throw new PermissaoDoPluginNegadaError(
    runtime.pluginId,
    permissao,
    decisao.reason === 'entitlement'
      ? `a empresa não tem o módulo "${moduleOf(permissao)}" contratado`
      : 'a instalação não concedeu essa permissão',
  );
}

/**
 * Um plugin first-party montado: manifesto (dado) + o schema que valida a
 * configuração informada na instalação.
 *
 * O schema de configuração NÃO cabe no manifesto porque o manifesto é
 * serializável; aqui ele é Zod, do mesmo jeito que as rotas REST e as tools
 * MCP fazem — uma verdade só sobre o que é aceito.
 */
export interface PluginDefinition<TConfig = unknown> {
  readonly manifest: PluginManifest;
  readonly configSchema: z.ZodType<TConfig>;
  /**
   * Diagnóstico da instalação de UMA empresa. Sem isto, "habilitado" e
   * "funcionando" viram a mesma coisa no painel — e não são.
   */
  verificarSaude?(runtime: PluginRuntime<TConfig>): Promise<PluginHealth>;
}

export type PluginHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface PluginHealth {
  readonly status: PluginHealthStatus;
  readonly detail?: string;
}

/**
 * Ciclo de vida da instalação de um plugin em UMA empresa.
 *
 * `available` (no catálogo, não instalado) e `healthy` não são estados
 * guardados: o primeiro é ausência de linha, o segundo é resultado de um
 * health check, que muda sozinho e mentiria se virasse coluna. As transições
 * válidas são invariante de domínio e vivem em `modules/plugins`.
 */
export type PluginStatus = 'installed' | 'configured' | 'enabled' | 'disabled';

/**
 * Como a borda de um plugin obtém o runtime da chamada.
 *
 * Porta declarada aqui, no SDK, para que o pacote do plugin não precise
 * depender do módulo que administra instalações — ele consome o contrato, não
 * a implementação. Quem liga as pontas é o composition root.
 */
export interface PluginRuntimeProvider<TConfig = unknown> {
  carregar(entrada: {
    tenantId: string;
    actorId: string;
    /** Módulos que a empresa mantém contratados, no momento da chamada. */
    entitlements: readonly string[];
  }): Promise<PluginRuntime<TConfig>>;
}
