import { jsonSchemaDeZod, type McpCatalog } from '@ecojotaduo/mcp-kit';
import { runWithContext } from '@ecojotaduo/tenant-context';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { SessaoMcp } from './authorize';
import { comoErroDeTool, protocolo } from './errors';

export const NOME_DO_GATEWAY = 'ecojotaduo-mcp-gateway';
export const VERSAO_DO_GATEWAY = '0.1.0';

const INSTRUCOES = [
  'Capacidades de negócio da plataforma ecoJotaduo.',
  'A empresa (tenant) já está fixada pela credencial usada na conexão: nenhuma',
  'chamada aceita parâmetro de empresa.',
  'O catálogo visível é o desta empresa e o desta credencial — outra empresa vê outro catálogo.',
].join(' ');

/**
 * Monta um servidor MCP para UMA sessão já autorizada.
 *
 * É construído por requisição de propósito: em modo stateless o acesso é
 * resolvido do banco a cada chamada, então o catálogo que o host enxerga
 * nunca fica mais velho que a autorização dele. Papel revogado some da
 * listagem na requisição seguinte, sem esperar o token expirar.
 */
export function criarServidorMcp(
  catalogo: McpCatalog,
  sessao: SessaoMcp,
): Server {
  const server = new Server(
    { name: NOME_DO_GATEWAY, version: VERSAO_DO_GATEWAY },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: INSTRUCOES,
    },
  );

  /**
   * Toda capacidade executa dentro do RequestContext da sessão — é ele que
   * leva tenant, ator, canal e correlação até a persistência e a auditoria.
   * Fora dele o repositório se recusa a consultar, e é assim que tem que ser.
   */
  const executar = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithContext(sessao.contexto, fn);

  server.setRequestHandler(
    ListToolsRequestSchema,
    protocolo(() => ({
      tools: catalogo.toolsDe(sessao.grant).map((tool): Tool => ({
        name: tool.name,
        description: tool.description,
        // O JSON Schema publicado vem do MESMO Zod que valida a chamada: o
        // que o agente lê não tem como divergir do que o servidor aceita.
        inputSchema: jsonSchemaDeZod(tool.inputSchema) as Tool['inputSchema'],
        annotations: { readOnlyHint: tool.readOnly },
      })),
    })),
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    protocolo(async (requisicao) => {
      // Autorização e validação ficam FORA do try: falha aqui é erro de
      // protocolo, não resultado de tool — a chamada não chegou a acontecer.
      const tool = catalogo.acharTool(sessao.grant, requisicao.params.name);
      const entrada = tool.inputSchema.parse(requisicao.params.arguments ?? {});

      try {
        const resultado = await executar(() =>
          tool.handle(entrada as never, sessao.capacidade),
        );
        return { content: [conteudoDeTexto(resultado)] };
      } catch (erro) {
        return comoErroDeTool(erro);
      }
    }),
  );

  /**
   * `resources/list` fica vazio de propósito: os recursos do CRM são por
   * cliente, e enumerar a carteira inteira como recurso não escala nem
   * respeita paginação. A descoberta acontece pelos templates.
   */
  server.setRequestHandler(
    ListResourcesRequestSchema,
    protocolo(() => ({ resources: [] })),
  );

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    protocolo(() => ({
      resourceTemplates: catalogo.resourcesDe(sessao.grant).map((resource) => ({
        uriTemplate: resource.uriTemplate,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      })),
    })),
  );

  server.setRequestHandler(
    ReadResourceRequestSchema,
    protocolo(async (requisicao) => {
      const { uri } = requisicao.params;
      const { resource, variaveis } = catalogo.acharResource(sessao.grant, uri);
      const conteudo = await executar(() =>
        resource.read(variaveis, sessao.capacidade),
      );

      return {
        contents: [
          { uri, mimeType: resource.mimeType, text: JSON.stringify(conteudo) },
        ],
      };
    }),
  );

  server.setRequestHandler(
    ListPromptsRequestSchema,
    protocolo(() => ({
      prompts: catalogo.promptsDe(sessao.grant).map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments.map((argumento) => ({ ...argumento })),
      })),
    })),
  );

  server.setRequestHandler(
    GetPromptRequestSchema,
    protocolo(async (requisicao) => {
      const prompt = catalogo.acharPrompt(sessao.grant, requisicao.params.name);
      const montado = await executar(() =>
        prompt.build(requisicao.params.arguments ?? {}, sessao.capacidade),
      );

      return {
        description: montado.description,
        messages: [
          { role: 'user' as const, content: conteudoDeTexto(montado.text) },
        ],
      };
    }),
  );

  return server;
}

function conteudoDeTexto(valor: unknown) {
  return {
    type: 'text' as const,
    text: typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2),
  };
}
