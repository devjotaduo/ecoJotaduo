import type { AccessGrant } from '@ecojotaduo/permissions';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { definirTool, type McpContribution } from './contract';
import {
  AcessoNegadoError,
  CapabilidadeSemPermissaoError,
  casarUri,
  jsonSchemaDeZod,
  McpCatalog,
  ToolDesconhecidaError,
} from './registry';

function contribuicao(parcial: Partial<McpContribution> = {}): McpContribution {
  return { tools: [], resources: [], prompts: [], ...parcial };
}

const ler = definirTool({
  name: 'crm.customer.search',
  description: 'Pesquisa clientes.',
  inputSchema: z.object({ termo: z.string().optional() }),
  requiredPermissions: ['crm.customer.read'],
  readOnly: true,
  handle: () => Promise.resolve({}),
});

const escrever = definirTool({
  name: 'crm.customer.create',
  description: 'Cadastra cliente.',
  inputSchema: z.object({ name: z.string() }),
  requiredPermissions: ['crm.customer.create'],
  readOnly: false,
  handle: () => Promise.resolve({}),
});

const grant = (parcial: Partial<AccessGrant> = {}): AccessGrant => ({
  permissions: ['*'],
  scopes: ['*'],
  entitlements: ['crm'],
  ...parcial,
});

describe('McpCatalog', () => {
  const catalogo = new McpCatalog([contribuicao({ tools: [ler, escrever] })]);

  it('lista só o que o grant alcança', () => {
    const somenteLeitura = catalogo.toolsDe(
      grant({ permissions: ['crm.customer.read'] }),
    );
    expect(somenteLeitura.map((tool) => tool.name)).toEqual([
      'crm.customer.search',
    ]);
  });

  it('esconde tudo de quem não contratou o módulo', () => {
    expect(catalogo.toolsDe(grant({ entitlements: [] }))).toEqual([]);
  });

  it('autoriza de novo na chamada — listar e executar veem o mesmo recorte', () => {
    // Sem isto, adivinhar o nome de uma tool que não aparece na listagem
    // seria caminho de acesso.
    const semEscrita = grant({ permissions: ['crm.customer.read'] });
    expect(() => catalogo.acharTool(semEscrita, 'crm.customer.create')).toThrow(
      AcessoNegadoError,
    );
  });

  it('tool inexistente é erro próprio, distinto de acesso negado', () => {
    expect(() => catalogo.acharTool(grant(), 'crm.execute_sql')).toThrow(
      ToolDesconhecidaError,
    );
  });

  it('recusa a montagem de capacidade sem permissão declarada', () => {
    // Uma tool sem permissão seria visível e executável por qualquer empresa.
    const aberta = {
      ...ler,
      name: 'crm.customer.open',
      requiredPermissions: [],
    };
    expect(() => new McpCatalog([contribuicao({ tools: [aberta] })])).toThrow(
      CapabilidadeSemPermissaoError,
    );
  });

  it('recusa duas tools com o mesmo nome', () => {
    expect(
      () =>
        new McpCatalog([
          contribuicao({ tools: [ler] }),
          contribuicao({ tools: [ler] }),
        ]),
    ).toThrow(/disputam o nome/);
  });
});

describe('casarUri', () => {
  const template = 'crm://customers/{customerId}';

  it('extrai a variável', () => {
    expect(casarUri(template, 'crm://customers/abc-123')).toEqual({
      customerId: 'abc-123',
    });
  });

  it('uma variável não atravessa a barra', () => {
    // Se `{customerId}` engolisse `/`, a leitura do histórico cairia no
    // recurso da ficha e devolveria o dado errado.
    expect(casarUri(template, 'crm://customers/abc/history')).toBeUndefined();
    expect(
      casarUri(
        'crm://customers/{customerId}/history',
        'crm://customers/abc/history',
      ),
    ).toEqual({ customerId: 'abc' });
  });

  it('não casa caminho parcial nem vazio', () => {
    expect(casarUri(template, 'crm://customers/')).toBeUndefined();
    expect(casarUri(template, 'crm://customers')).toBeUndefined();
    expect(casarUri(template, 'outro://customers/abc')).toBeUndefined();
  });

  it('decodifica o valor percentualmente codificado', () => {
    expect(casarUri(template, 'crm://customers/a%20b')).toEqual({
      customerId: 'a b',
    });
  });
});

describe('jsonSchemaDeZod', () => {
  it('gera objeto JSON Schema sem o metadado $schema', () => {
    const gerado = jsonSchemaDeZod(
      z.object({ limit: z.number().int().default(20) }),
    );
    expect(gerado.type).toBe('object');
    expect(gerado.$schema).toBeUndefined();
    // Campo com default é opcional na entrada.
    expect(gerado.required).toBeUndefined();
  });
});
