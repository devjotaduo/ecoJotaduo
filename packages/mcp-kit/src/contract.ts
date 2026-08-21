import type { z } from 'zod';

/**
 * Contrato das contribuições MCP dos módulos.
 *
 * Vive aqui, e não dentro de um módulo, porque é superfície de plataforma: o
 * gateway agrega contribuições de vários módulos e nenhum módulo pode virar
 * dependência do outro só para reusar o tipo (ver `docs/adr/0004`).
 *
 * Nenhum símbolo do SDK MCP aparece neste pacote de propósito. Módulo não
 * conhece transporte: se a especificação trocar de transporte amanhã, só o
 * `apps/mcp-gateway` muda.
 */

/** Identidade já resolvida pelo gateway. Nunca vem de parâmetro da tool. */
export interface McpToolContext {
  readonly tenantId: string;
  readonly actorId: string;
}

/** Comum a tool, resource e prompt: o que a autorização precisa saber. */
export interface McpCapability {
  readonly name: string;
  readonly description: string;
  /** Todas exigidas (AND), no formato `modulo.recurso.acao`. */
  readonly requiredPermissions: readonly string[];
}

export interface McpToolDefinition extends McpCapability {
  readonly inputSchema: z.ZodType;
  /** Só leitura: informa o host que a chamada não altera estado. */
  readonly readOnly: boolean;
  /**
   * Interface interativa associada, quando existe (`ui://...`).
   *
   * É SUGESTÃO ao host: a tool continua devolvendo o resultado estruturado de
   * sempre, e um host sem suporte a Apps usa só ele. Nenhuma decisão de
   * negócio depende de a interface ter sido renderizada.
   */
  readonly appUri?: string;
  /** A entrada já vem validada pelo `inputSchema` (o gateway valida antes). */
  handle(entrada: never, contexto: McpToolContext): Promise<unknown>;
}

/**
 * Corpo de um MCP App: o que roda dentro do iframe do host.
 *
 * Vem em pedaços, e não como HTML pronto, porque quem monta o documento é o
 * gateway — é ele que injeta o runtime do protocolo e a Content-Security-Policy.
 * Um módulo que montasse o HTML inteiro poderia esquecer a CSP, e ninguém
 * perceberia até um app de terceiro fazer algo que não devia.
 */
export interface McpAppBody {
  /** Markup do corpo. Sem `<script>`: o script vai no campo próprio. */
  readonly markup: string;
  readonly style: string;
  /**
   * Script do app. Recebe `app` — a instância já conectada do runtime MCP — e
   * `raiz`, o elemento onde renderizar.
   */
  readonly script: string;
}

/**
 * Interface interativa que o host renderiza num iframe isolado.
 *
 * Como toda capacidade MCP, declara permissões e é filtrada pelo `AccessGrant`:
 * um app que a empresa não alcança não aparece na listagem de recursos e não é
 * legível nem com a URI em mãos.
 */
export interface McpAppDefinition extends McpCapability {
  /** `ui://<modulo>/<app>.html` — o esquema que identifica um MCP App. */
  readonly uri: string;
  readonly title: string;
  /**
   * Domínios externos que o app pode contactar. Vazio (o padrão) significa
   * NENHUM: o app fala só com o host, por postMessage. Abrir um domínio aqui
   * é dar a ele um canal de saída — declare apenas o que for indispensável.
   */
  readonly connectDomains?: readonly string[];
  readonly body: McpAppBody;
}

export interface McpResourceDefinition extends McpCapability {
  /** Ex.: `crm://customers/{customerId}` — variáveis entre chaves. */
  readonly uriTemplate: string;
  readonly mimeType: string;
  read(
    variaveis: Readonly<Record<string, string>>,
    contexto: McpToolContext,
  ): Promise<unknown>;
}

export interface McpPromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

export interface McpPromptDefinition extends McpCapability {
  readonly arguments: readonly McpPromptArgument[];
  build(
    argumentos: Readonly<Record<string, string>>,
    contexto: McpToolContext,
  ): Promise<{ readonly description: string; readonly text: string }>;
}

export interface McpContribution {
  readonly tools: readonly McpToolDefinition[];
  readonly resources: readonly McpResourceDefinition[];
  readonly prompts: readonly McpPromptDefinition[];
  /** Interfaces interativas. Opcional: a maioria dos módulos não tem. */
  readonly apps?: readonly McpAppDefinition[];
}

/**
 * Declara uma tool inferindo o tipo de entrada a partir do schema.
 *
 * A lista guarda tools de entradas diferentes; `handle(entrada: never)` no
 * contrato é o que permite guardá-las juntas sem elenco (contravariância) e,
 * de quebra, obriga quem chama a tool a validar antes pelo `inputSchema` —
 * que é exatamente o que o gateway faz.
 */
export function definirTool<S extends z.ZodType>(definicao: {
  name: string;
  description: string;
  inputSchema: S;
  requiredPermissions: readonly string[];
  readOnly: boolean;
  appUri?: string;
  handle(entrada: z.output<S>, contexto: McpToolContext): Promise<unknown>;
}): McpToolDefinition {
  return definicao;
}
