import { pluginEntitlement } from '@ecojotaduo/permissions';
import { z } from 'zod';

/**
 * Manifesto de plugin — o contrato entre quem escreve a extensão e a
 * plataforma que a instala.
 *
 * É **dado puro e serializável** de propósito: o mesmo formato vale para o
 * plugin first-party (que vive no monorepo) e para o externo (que um dia
 * chegará como JSON de um repositório de plugins). Nada de função aqui; o que
 * carrega comportamento é a `PluginDefinition`, montada no composition root.
 *
 * `manifestVersion` existe para o formato poder crescer sem quebrar quem já
 * publicou — a validação recusa versão que não conhece, em vez de ignorar
 * campos em silêncio.
 */

/** Só letras minúsculas, dígitos e hífen: o id vira parte de permissão e URL. */
const idDePlugin = z
  .string()
  .min(3)
  .max(40)
  .regex(
    /^[a-z][a-z0-9-]*[a-z0-9]$/,
    'use minúsculas, dígitos e hífen (ex.: notifications-example)',
  );

const evento = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+\.v\d+$/,
    'evento é `dominio.entidade.acao.vN` (ex.: crm.customer.created.v1)',
  );

export const pluginManifestSchema = z.object({
  manifestVersion: z.literal('1'),
  id: idDePlugin,
  name: z.string().min(3).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'versão semântica, ex.: 1.0.0'),
  publisher: z.string().min(2).max(120),
  /**
   * `first-party` roda no processo da plataforma (código nosso, revisado).
   * `remote` roda fora, atrás do gateway de plugins — nunca no core
   * (ADR-0005). Não existe terceira opção: carregar JavaScript de terceiro
   * in-process está fora de cogitação.
   */
  type: z.enum(['first-party', 'remote']),
  platformVersion: z.string().min(1),
  description: z.string().min(10).max(500),
  /**
   * O que o plugin PEDE para agir em nome da empresa. Quem instala concede
   * (um subconjunto), e a concessão é verificada a cada chamada.
   */
  permissions: z.array(z.string()).max(50),
  /** Capacidades que o plugin contribui para as bordas da plataforma. */
  capabilities: z.object({
    http: z.boolean().default(false),
    mcp: z.boolean().default(false),
  }),
  /** Chaves de configuração sensível exigidas antes de habilitar. */
  requiredSecrets: z.array(z.string().min(1).max(60)).max(20).default([]),
  /** Eventos que o plugin consome. Entregue a partir da Fase 8. */
  subscribesTo: z.array(evento).max(50).default([]),
  /** Eventos que o plugin publica. Entregue a partir da Fase 8. */
  publishes: z.array(evento).max(50).default([]),
});

export type PluginManifest = z.output<typeof pluginManifestSchema>;

export class ManifestoInvalidoError extends Error {
  constructor(
    readonly pluginId: string,
    readonly violacoes: readonly string[],
  ) {
    super(
      `Manifesto do plugin "${pluginId}" é inválido:\n${violacoes
        .map((violacao) => `  - ${violacao}`)
        .join('\n')}`,
    );
    this.name = 'ManifestoInvalidoError';
  }
}

export interface OpcoesDeValidacao {
  /**
   * Eventos que a plataforma realmente publica (vindos dos manifestos dos
   * módulos). Sem esta conferência, um `subscribesTo` com erro de digitação
   * ficaria em silêncio até alguém investigar por que o plugin "nunca roda".
   */
  readonly eventosConhecidos?: readonly string[];
}

export function validarManifesto(
  bruto: unknown,
  opcoes: OpcoesDeValidacao = {},
): PluginManifest {
  const resultado = pluginManifestSchema.safeParse(bruto);
  const identificacao =
    typeof bruto === 'object' && bruto !== null && 'id' in bruto
      ? String(bruto.id)
      : '(sem id)';

  if (!resultado.success) {
    throw new ManifestoInvalidoError(
      identificacao,
      resultado.error.issues.map(
        (issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
      ),
    );
  }

  const manifesto = resultado.data;
  const violacoes: string[] = [];

  // O plugin não pode pedir permissão sobre si mesmo: quem concede acesso à
  // capacidade do plugin é o papel do usuário, não a instalação.
  const proprio = `${pluginEntitlement(manifesto.id)}.`;
  for (const permissao of manifesto.permissions) {
    if (permissao.startsWith(proprio)) {
      violacoes.push(
        `permissions: "${permissao}" é capacidade do próprio plugin, não algo que ele peça à plataforma`,
      );
    }
  }

  if (opcoes.eventosConhecidos) {
    const conhecidos = new Set(opcoes.eventosConhecidos);
    for (const tipo of [...manifesto.subscribesTo, ...manifesto.publishes]) {
      if (!conhecidos.has(tipo)) {
        violacoes.push(`evento "${tipo}" não é publicado por nenhum módulo`);
      }
    }
  }

  if (violacoes.length > 0) {
    throw new ManifestoInvalidoError(manifesto.id, violacoes);
  }
  return manifesto;
}
