import {
  validarManifesto,
  type PluginDefinition,
} from '@ecojotaduo/plugin-sdk';

import { PluginDesconhecidoError } from './domain/errors';

/**
 * Catálogo de plugins DESTA instalação da plataforma.
 *
 * Registro explícito, em tempo de bootstrap — a plataforma não descobre nem
 * baixa plugin para executar (ADR-0005). Instalar um plugin numa empresa é
 * escolher, no catálogo, algo que já está no processo; nunca é trazer código
 * novo para dentro dele.
 */
export class PluginCatalog {
  private readonly porId: ReadonlyMap<string, PluginDefinition>;

  constructor(
    definicoes: readonly PluginDefinition[],
    opcoes: { eventosConhecidos?: readonly string[] } = {},
  ) {
    const mapa = new Map<string, PluginDefinition>();
    for (const definicao of definicoes) {
      // Valida no boot, não na instalação: manifesto quebrado tem que derrubar
      // o deploy, e não esperar a primeira empresa tentar instalar.
      const manifesto = validarManifesto(definicao.manifest, opcoes);
      if (mapa.has(manifesto.id)) {
        throw new Error(`Dois plugins disputam o id "${manifesto.id}".`);
      }
      mapa.set(manifesto.id, definicao);
    }
    this.porId = mapa;
  }

  list(): PluginDefinition[] {
    return [...this.porId.values()];
  }

  exigir(pluginId: string): PluginDefinition {
    const definicao = this.porId.get(pluginId);
    if (!definicao) {
      throw new PluginDesconhecidoError(pluginId);
    }
    return definicao;
  }
}
