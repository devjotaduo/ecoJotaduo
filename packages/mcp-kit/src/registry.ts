import {
  authorize,
  ForbiddenError,
  type AccessGrant,
} from '@ecojotaduo/permissions';
import { z } from 'zod';

import type {
  McpAppDefinition,
  McpCapability,
  McpContribution,
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolDefinition,
} from './contract';

/**
 * Acesso negado a uma capacidade MCP.
 *
 * Estende o `ForbiddenError` do motor de autorização (mesma decisão, mesma
 * mensagem), mas é declarado AQUI de propósito: quem consome o catálogo trata
 * os erros do catálogo, sem precisar conhecer o pacote de permissões que ele
 * usa por dentro. Cross-package `instanceof` também é frágil — basta o
 * empacotador carregar duas cópias do módulo para a checagem virar `false` e
 * um "acesso negado" degradar silenciosamente para "erro interno".
 */
export class AcessoNegadoError extends ForbiddenError {
  constructor(base: ForbiddenError) {
    super(base.reason, base.required, base.moduleId);
    this.name = 'AcessoNegadoError';
  }
}

/** Uma capacidade sem permissão declarada seria aberta a todos os tenants. */
export class CapabilidadeSemPermissaoError extends Error {
  constructor(name: string) {
    super(
      `A capacidade MCP "${name}" não declara permissões. Toda tool, resource ou prompt precisa exigir ao menos uma.`,
    );
    this.name = 'CapabilidadeSemPermissaoError';
  }
}

export class ToolDesconhecidaError extends Error {
  constructor(name: string) {
    super(
      `Tool "${name}" não existe ou não está disponível para esta empresa.`,
    );
    this.name = 'ToolDesconhecidaError';
  }
}

export class RecursoDesconhecidoError extends Error {
  constructor(uri: string) {
    super(
      `Recurso "${uri}" não existe ou não está disponível para esta empresa.`,
    );
    this.name = 'RecursoDesconhecidoError';
  }
}

export class AppDesconhecidoError extends Error {
  constructor(uri: string) {
    super(
      `Interface "${uri}" não existe ou não está disponível para esta empresa.`,
    );
    this.name = 'AppDesconhecidoError';
  }
}

/** Tool que aponta para um app inexistente renderizaria uma tela em branco. */
export class AppInexistenteError extends Error {
  constructor(tool: string, uri: string) {
    super(
      `A tool "${tool}" aponta para a interface "${uri}", que nenhum módulo declara.`,
    );
    this.name = 'AppInexistenteError';
  }
}

export class PromptDesconhecidoError extends Error {
  constructor(name: string) {
    super(
      `Prompt "${name}" não existe ou não está disponível para esta empresa.`,
    );
    this.name = 'PromptDesconhecidoError';
  }
}

/**
 * Catálogo MCP da instalação: junta as contribuições dos módulos e responde
 * sempre em função de um `AccessGrant`.
 *
 * O grant é parâmetro de todo método de propósito — não existe "listar tudo".
 * É o que faz descoberta e execução enxergarem exatamente o mesmo recorte:
 * uma tool que não aparece na listagem também não executa se for adivinhada.
 */
export class McpCatalog {
  private readonly tools: readonly McpToolDefinition[];
  private readonly resources: readonly McpResourceDefinition[];
  private readonly prompts: readonly McpPromptDefinition[];
  private readonly apps: readonly McpAppDefinition[];

  constructor(contribuicoes: readonly McpContribution[]) {
    this.tools = contribuicoes.flatMap((c) => c.tools);
    this.resources = contribuicoes.flatMap((c) => c.resources);
    this.prompts = contribuicoes.flatMap((c) => c.prompts);
    this.apps = contribuicoes.flatMap((c) => c.apps ?? []);

    for (const capacidade of [
      ...this.tools,
      ...this.resources,
      ...this.prompts,
      ...this.apps,
    ]) {
      if (capacidade.requiredPermissions.length === 0) {
        throw new CapabilidadeSemPermissaoError(capacidade.name);
      }
    }
    const nomes = this.tools.map((tool) => tool.name);
    const duplicado = nomes.find((nome, i) => nomes.indexOf(nome) !== i);
    if (duplicado) {
      throw new Error(`Duas tools MCP disputam o nome "${duplicado}".`);
    }

    // Falha na montagem, e não na primeira chamada: uma tool que aponta para
    // interface inexistente renderizaria tela em branco no host de quem a usa.
    for (const tool of this.tools) {
      if (tool.appUri && !this.apps.some((app) => app.uri === tool.appUri)) {
        throw new AppInexistenteError(tool.name, tool.appUri);
      }
    }
  }

  toolsDe(grant: AccessGrant): McpToolDefinition[] {
    return filtrar(this.tools, grant);
  }

  resourcesDe(grant: AccessGrant): McpResourceDefinition[] {
    return filtrar(this.resources, grant);
  }

  promptsDe(grant: AccessGrant): McpPromptDefinition[] {
    return filtrar(this.prompts, grant);
  }

  appsDe(grant: AccessGrant): McpAppDefinition[] {
    return filtrar(this.apps, grant);
  }

  /** Lança `AppDesconhecidoError` quando o grant não alcança a interface. */
  acharApp(grant: AccessGrant, uri: string): McpAppDefinition {
    const app = this.apps.find((candidato) => candidato.uri === uri);
    if (!app) {
      throw new AppDesconhecidoError(uri);
    }
    exigir(grant, app.requiredPermissions);
    return app;
  }

  /** Lança `ToolDesconhecidaError` quando o grant não alcança a tool. */
  acharTool(grant: AccessGrant, name: string): McpToolDefinition {
    const tool = this.tools.find((candidata) => candidata.name === name);
    if (!tool) {
      throw new ToolDesconhecidaError(name);
    }
    // Autoriza de novo, mesmo já tendo filtrado a listagem: o host pode
    // chamar um nome que nunca listou.
    exigir(grant, tool.requiredPermissions);
    return tool;
  }

  /** Casa a URI contra os templates e devolve o recurso com as variáveis. */
  acharResource(
    grant: AccessGrant,
    uri: string,
  ): { resource: McpResourceDefinition; variaveis: Record<string, string> } {
    for (const resource of this.resources) {
      const variaveis = casarUri(resource.uriTemplate, uri);
      if (variaveis) {
        exigir(grant, resource.requiredPermissions);
        return { resource, variaveis };
      }
    }
    throw new RecursoDesconhecidoError(uri);
  }

  acharPrompt(grant: AccessGrant, name: string): McpPromptDefinition {
    const prompt = this.prompts.find((candidato) => candidato.name === name);
    if (!prompt) {
      throw new PromptDesconhecidoError(name);
    }
    exigir(grant, prompt.requiredPermissions);
    return prompt;
  }
}

/** Exige todas as permissões (AND), traduzindo a recusa para o erro do kit. */
function exigir(grant: AccessGrant, permissoes: readonly string[]): void {
  for (const permissao of permissoes) {
    const decisao = authorize(grant, permissao);
    if (!decisao.allowed) {
      throw new AcessoNegadoError(
        new ForbiddenError(decisao.reason, decisao.required, decisao.moduleId),
      );
    }
  }
}

function filtrar<T extends McpCapability>(
  itens: readonly T[],
  grant: AccessGrant,
): T[] {
  return itens.filter((item) =>
    item.requiredPermissions.every(
      (permissao) => authorize(grant, permissao).allowed,
    ),
  );
}

/**
 * Casa uma URI concreta contra um template `esquema://caminho/{variavel}`.
 *
 * Cada variável casa um único segmento (`[^/]+`), então
 * `crm://customers/{id}` não engole `crm://customers/x/history` — o que
 * mandaria a leitura do histórico para o recurso errado.
 */
export function casarUri(
  template: string,
  uri: string,
): Record<string, string> | undefined {
  const partes = template.split(/\{(\w+)\}/g);
  const nomes: string[] = [];
  let padrao = '^';

  for (const [indice, parte] of partes.entries()) {
    if (indice % 2 === 0) {
      padrao += parte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else {
      nomes.push(parte);
      padrao += '([^/]+)';
    }
  }

  const casamento = new RegExp(`${padrao}$`).exec(uri);
  if (!casamento) {
    return undefined;
  }
  return Object.fromEntries(
    nomes.map((nome, indice) => [
      nome,
      decodeURIComponent(casamento[indice + 1] ?? ''),
    ]),
  );
}

/**
 * Converte o schema Zod da tool no JSON Schema que o MCP publica.
 *
 * É o MESMO schema que valida a chamada — a descrição que o agente lê nunca
 * diverge do que o servidor aceita. `$schema` é metadado do documento JSON
 * Schema e vira ruído dentro da definição de tool.
 */
export function jsonSchemaDeZod(schema: z.ZodType): Record<string, unknown> {
  const gerado = z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-2020-12',
  }) as Record<string, unknown>;
  delete gerado.$schema;
  return gerado;
}
