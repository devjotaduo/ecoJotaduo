import type { AddressInfo } from 'node:net';

import { loadEnv } from '@ecojotaduo/config';
import { runMigrations } from '@ecojotaduo/database';
import type { NucleoDaPlataforma } from '@ecojotaduo/platform-core';
import { ACAO_DE_NEGACAO } from '@ecojotaduo/audit';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  PAPEL_MEMBER,
  prepararBancoDeTestes,
  semearTenant,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import { createContext, runWithContext } from '@ecojotaduo/tenant-context';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { criarGateway, type Gateway } from '../src/gateway';

exigirBancoEmCI();

const CNPJ = '11.222.333/0001-81';

/**
 * Fase 5 ponta a ponta, com o CLIENTE OFICIAL do MCP falando Streamable HTTP
 * contra o gateway de verdade e um PostgreSQL de verdade.
 *
 * Usar o SDK do cliente é o teste de compatibilidade de protocolo: o
 * handshake de `initialize`, a negociação de versão e o formato de cada
 * resposta são validados pela mesma biblioteca que os hosts usam. Um servidor
 * que só passa em teste caseiro não prova nada sobre o protocolo.
 *
 * O critério de aceite da fase é o bloco "descoberta": um host autorizado
 * enxerga e executa apenas as capacidades da SUA empresa.
 */
describe.skipIf(!temBancoDeTeste)('Gateway MCP (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let gateway: Gateway;
  let nucleo: NucleoDaPlataforma;
  let endereco: string;

  let empresa: TenantSemeado;
  let concorrente: TenantSemeado;
  let semCrm: TenantSemeado;
  let visitante: TenantSemeado;

  /** Token real, emitido pelo mesmo login que a API REST usa. */
  async function entrar(tenant: TenantSemeado): Promise<string> {
    const sessao = await runWithContext(createContext('system'), () =>
      nucleo.signIn.execute({
        email: tenant.email,
        password: tenant.senha,
        tenantSlug: tenant.slug,
      }),
    );
    return sessao.accessToken;
  }

  /** Conecta um cliente MCP como o host de um agente conectaria. */
  async function conectar(token?: string): Promise<Client> {
    const cliente = new Client({ name: 'teste', version: '0.0.0' });
    const transporte = new StreamableHTTPClientTransport(new URL(endereco), {
      requestInit: token
        ? { headers: { authorization: `Bearer ${token}` } }
        : undefined,
    });
    await cliente.connect(transporte);
    return cliente;
  }

  async function conectarComo(tenant: TenantSemeado): Promise<Client> {
    return conectar(await entrar(tenant));
  }

  async function criarCliente(
    cliente: Client,
    nome: string,
    documento?: string,
  ) {
    const resultado = await cliente.callTool({
      name: 'crm.customer.create',
      arguments: { name: nome, document: documento ?? null },
    });
    expect(resultado.isError, JSON.stringify(resultado.content)).toBeFalsy();
    return JSON.parse(textoDe(resultado)) as { id: string; name: string };
  }

  function textoDe(resultado: unknown): string {
    const conteudo = (resultado as { content: { text?: string }[] }).content;
    return conteudo[0]?.text ?? '';
  }

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());

    process.env.DATABASE_URL = urlDaAplicacao();
    process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';

    gateway = await criarGateway(loadEnv());
    nucleo = gateway.nucleo;
    // Porta efêmera: o cliente MCP fala HTTP de verdade, não injeção.
    await gateway.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = gateway.app.server.address() as AddressInfo;
    endereco = `http://127.0.0.1:${port}/mcp`;
  });

  afterAll(async () => {
    await gateway?.app.close();
    await nucleo?.handle.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });
    // Outra empresa, também com CRM: é contra ela que o isolamento é medido.
    concorrente = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm'],
    });
    // Mesma plataforma, sem o módulo CRM contratado.
    semCrm = await semearTenant(dono, {
      slug: 'empresa-c',
      email: 'carla@empresa-c.com.br',
      modulos: [],
    });
    // CRM contratado, mas papel sem permissão nenhuma.
    visitante = await semearTenant(dono, {
      slug: 'empresa-d',
      email: 'davi@empresa-d.com.br',
      modulos: ['crm'],
      papelId: PAPEL_MEMBER,
    });
  });

  describe('descoberta filtrada por empresa', () => {
    it('publica as tools do CRM para quem contratou o módulo', async () => {
      const cliente = await conectarComo(empresa);
      const { tools } = await cliente.listTools();
      const nomes = tools.map((tool) => tool.name);

      expect(nomes).toEqual(
        expect.arrayContaining([
          'crm.customer.search',
          'crm.customer.get',
          'crm.customer.create',
          'crm.note.add',
          'crm.appointment.schedule',
          'crm.appointment.complete',
          'crm.agenda.list',
        ]),
      );

      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        // O tenant nunca é parâmetro: vem do token, não do modelo.
        expect(JSON.stringify(tool.inputSchema)).not.toContain('tenantId');
      }
      await cliente.close();
    });

    it('empresa sem o módulo contratado não enxerga nem executa nada do CRM', async () => {
      const cliente = await conectarComo(semCrm);

      expect((await cliente.listTools()).tools).toEqual([]);
      expect((await cliente.listResourceTemplates()).resourceTemplates).toEqual(
        [],
      );
      expect((await cliente.listPrompts()).prompts).toEqual([]);

      // E adivinhar o nome não ajuda: a autorização roda de novo na chamada.
      await expect(
        cliente.callTool({
          name: 'crm.customer.search',
          arguments: {},
        }),
      ).rejects.toThrow(/não está contratado/i);
      await cliente.close();
    });

    it('vínculo sem permissão vê catálogo vazio, mesmo com o módulo contratado', async () => {
      const cliente = await conectarComo(visitante);
      expect((await cliente.listTools()).tools).toEqual([]);
      await expect(
        cliente.callTool({ name: 'crm.customer.create', arguments: {} }),
      ).rejects.toThrow(/permissão/i);
      await cliente.close();
    });

    it('recusa a conexão sem credencial', async () => {
      await expect(conectar()).rejects.toThrow();
    });

    it('recusa token adulterado', async () => {
      const token = await entrar(empresa);
      await expect(conectar(`${token}x`)).rejects.toThrow();
    });
  });

  describe('execução', () => {
    it('executa o caso de uso e a leitura enxerga a escrita', async () => {
      const cliente = await conectarComo(empresa);
      const criado = await criarCliente(cliente, 'Construtora Alfa', CNPJ);

      const busca = await cliente.callTool({
        name: 'crm.customer.search',
        arguments: { termo: 'Alfa' },
      });
      const pagina = JSON.parse(textoDe(busca)) as {
        items: { id: string; documentFormatted: string }[];
        total: number;
      };

      expect(pagina.total).toBe(1);
      expect(pagina.items[0]?.id).toBe(criado.id);
      expect(pagina.items[0]?.documentFormatted).toBe(CNPJ);
      await cliente.close();
    });

    it('recusa do domínio volta como resultado de tool, não como erro de protocolo', async () => {
      // A diferença importa: o agente consegue corrigir e tentar de novo, em
      // vez de concluir que a ferramenta está quebrada.
      const cliente = await conectarComo(empresa);
      await criarCliente(cliente, 'Construtora Alfa', CNPJ);

      const repetido = await cliente.callTool({
        name: 'crm.customer.create',
        arguments: { name: 'Alfa de novo', document: CNPJ },
      });

      expect(repetido.isError).toBe(true);
      expect(textoDe(repetido)).toMatch(
        /já (existe|está cadastrado)|duplicad/i,
      );
      await cliente.close();
    });

    it('entrada inválida é erro de protocolo, com as violações', async () => {
      const cliente = await conectarComo(empresa);
      const erro = await cliente
        .callTool({ name: 'crm.customer.create', arguments: { name: 'x' } })
        .catch((falha: unknown) => falha);

      expect(erro).toBeInstanceOf(McpError);
      expect((erro as McpError).code).toBe(ErrorCode.InvalidParams);
      await cliente.close();
    });

    it('tool inexistente responde method not found', async () => {
      const cliente = await conectarComo(empresa);
      const erro = await cliente
        .callTool({ name: 'crm.customer.delete_all', arguments: {} })
        .catch((falha: unknown) => falha);

      expect((erro as McpError).code).toBe(ErrorCode.MethodNotFound);
      await cliente.close();
    });
  });

  describe('isolamento entre empresas', () => {
    it('cliente cadastrado em uma empresa não aparece na outra', async () => {
      const daEmpresa = await conectarComo(empresa);
      const criado = await criarCliente(daEmpresa, 'Construtora Alfa', CNPJ);

      const daConcorrente = await conectarComo(concorrente);
      const busca = await daConcorrente.callTool({
        name: 'crm.customer.search',
        arguments: { termo: 'Alfa' },
      });
      expect((JSON.parse(textoDe(busca)) as { total: number }).total).toBe(0);

      // Nem com o id em mãos: o tenant do token não bate com o do registro.
      const porId = await daConcorrente.callTool({
        name: 'crm.customer.get',
        arguments: { customerId: criado.id },
      });
      expect(porId.isError).toBe(true);
      expect(textoDe(porId)).toMatch(/não encontrado|inexistente/i);

      // E o mesmo documento pode ser cadastrado na outra empresa: a unicidade
      // é por empresa, não global — prova de que a busca também é.
      await criarCliente(daConcorrente, 'Homônima', CNPJ);

      await daEmpresa.close();
      await daConcorrente.close();
    });
  });

  describe('resources e prompts', () => {
    it('lê um cliente por URI e recusa a URI de outra empresa', async () => {
      const daEmpresa = await conectarComo(empresa);
      const criado = await criarCliente(daEmpresa, 'Construtora Alfa', CNPJ);

      const { resourceTemplates } = await daEmpresa.listResourceTemplates();
      expect(resourceTemplates.map((t) => t.uriTemplate)).toEqual([
        'crm://customers/{customerId}',
        'crm://customers/{customerId}/history',
      ]);

      const leitura = await daEmpresa.readResource({
        uri: `crm://customers/${criado.id}`,
      });
      // O conteúdo pode ser texto ou binário no contrato do MCP; o nosso é
      // JSON, então a leitura só faz sentido pelo ramo textual.
      const primeiro = leitura.contents[0] as { text?: string } | undefined;
      const ficha = JSON.parse(primeiro?.text ?? 'null') as {
        id: string;
        timeline: unknown[];
      };
      expect(ficha.id).toBe(criado.id);

      const daConcorrente = await conectarComo(concorrente);
      await expect(
        daConcorrente.readResource({ uri: `crm://customers/${criado.id}` }),
      ).rejects.toThrow(/não encontrado|inexistente/i);

      await daEmpresa.close();
      await daConcorrente.close();
    });

    it('o prompt vem preenchido com dados da empresa do token', async () => {
      const cliente = await conectarComo(empresa);
      const criado = await criarCliente(cliente, 'Construtora Alfa', CNPJ);

      const { prompts } = await cliente.listPrompts();
      expect(prompts.map((prompt) => prompt.name)).toEqual([
        'crm.customer.analysis',
      ]);

      const montado = await cliente.getPrompt({
        name: 'crm.customer.analysis',
        arguments: { customerId: criado.id },
      });
      const texto = String(
        (montado.messages[0]?.content as { text?: string }).text ?? '',
      );
      expect(texto).toContain('Construtora Alfa');
      await cliente.close();
    });

    it('URI fora do padrão não cai no recurso errado', async () => {
      const cliente = await conectarComo(empresa);
      await expect(
        cliente.readResource({ uri: 'crm://customers' }),
      ).rejects.toThrow();
      await cliente.close();
    });
  });

  describe('auditoria', () => {
    it('registra a escrita com o canal mcp', async () => {
      const cliente = await conectarComo(empresa);
      await criarCliente(cliente, 'Construtora Alfa', CNPJ);

      const trilha = await dono<{ channel: string; action: string }[]>`
        select channel, action from audit_events
        where tenant_id = ${empresa.tenantId} and action = 'crm.customer.created'
      `;

      expect(trilha).toHaveLength(1);
      expect(trilha[0]?.channel).toBe('mcp');
      await cliente.close();
    });

    /** Recusas do catálogo, na trilha da empresa que tentou. */
    async function negacoes(tenantId: string) {
      return dono<
        {
          resource_id: string | null;
          result: string;
          channel: string;
          metadata: { required?: string; reason?: string; moduleId?: string };
        }[]
      >`
        select resource_id, result, channel, metadata from audit_events
        where tenant_id = ${tenantId} and action = ${ACAO_DE_NEGACAO}
        order by occurred_at
      `;
    }

    it('tool adivinhada fora do recorte da empresa deixa rastro', async () => {
      const cliente = await conectarComo(semCrm);

      // O nome nunca apareceu na listagem desta empresa. Descoberta e execução
      // passam pela mesma decisão — e agora a tentativa também aparece.
      await expect(
        cliente.callTool({
          name: 'crm.customer.search',
          arguments: {},
        }),
      ).rejects.toThrow();

      const trilha = await negacoes(semCrm.tenantId);
      expect(trilha).toHaveLength(1);
      expect(trilha[0]?.result).toBe('denied');
      expect(trilha[0]?.channel).toBe('mcp');
      expect(trilha[0]?.resource_id).toBe('tool:crm.customer.search');
      expect(trilha[0]?.metadata.reason).toBe('entitlement');
      expect(trilha[0]?.metadata.moduleId).toBe('crm');
      await cliente.close();
    });

    it('resource adivinhado também deixa rastro', async () => {
      const cliente = await conectarComo(semCrm);

      await expect(
        cliente.readResource({
          uri: 'crm://customers/019a0000-0000-7000-8000-000000000001',
        }),
      ).rejects.toThrow();

      const trilha = await negacoes(semCrm.tenantId);
      expect(trilha).toHaveLength(1);
      expect(trilha[0]?.resource_id).toContain('resource:crm://customers/');
      await cliente.close();
    });

    it('listar não é recusa: filtrar não vira rastro de negação', async () => {
      const cliente = await conectarComo(semCrm);

      // O catálogo desta empresa é vazio, mas ninguém foi barrado — listar
      // deixa ver o que existe, e encher a trilha disso a tornaria inútil.
      expect((await cliente.listTools()).tools).toEqual([]);
      expect(await negacoes(semCrm.tenantId)).toHaveLength(0);
      await cliente.close();
    });
  });
});
