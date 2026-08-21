import { runMigrations } from '@ecojotaduo/database';
import type { NucleoDaPlataforma } from '@ecojotaduo/platform-core';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  prepararBancoDeTestes,
  semearTenant,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import {
  authenticateContext,
  createContext,
  runWithContext,
  toTenantId,
  toUserId,
} from '@ecojotaduo/tenant-context';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { PLATFORM_CORE } from '../src/bootstrap/tokens';
import { ProblemDetailsFilter } from '../src/http/problem-details.filter';
import { registrarContextoDeRequisicao } from '../src/http/request-context';

exigirBancoEmCI();

interface RespostaHttp {
  readonly statusCode: number;
  json(): unknown;
}

interface AtivoJson {
  id: string;
  code: string;
  name: string;
  status: string;
  availability: string;
  currentHold: { id: string; reason: string } | null;
}

interface BloqueioJson {
  id: string;
  assetId: string;
  reason: string;
  open: boolean;
  effectiveEndsAt: string;
}

interface DisponibilidadeJson {
  available: boolean;
  conflicts: { id: string }[];
}

const MODULOS = ['assets'];

function daquiA(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Fase 7, terceiro vertical: o ciclo de disponibilidade de um equipamento.
 *
 * O teste central é o segundo bloco: a disponibilidade nunca vem de uma coluna
 * — sai dos bloqueios, e a mesma linha do banco responde "livre" hoje e
 * "ocupada" na semana que vem sem que nada precise rodar no meio.
 */
describe.skipIf(!temBancoDeTeste)('Ativos (E2E)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let app: NestFastifyApplication;
  let nucleo: NucleoDaPlataforma;
  let empresa: TenantSemeado;
  let semAtivos: TenantSemeado;
  let operador: TenantSemeado;

  async function requisicao(opcoes: {
    method: 'GET' | 'POST';
    url: string;
    token?: string;
    payload?: unknown;
  }): Promise<RespostaHttp> {
    return app.inject({
      method: opcoes.method,
      url: opcoes.url,
      payload: opcoes.payload as never,
      headers: opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {},
    });
  }

  async function entrar(tenant: TenantSemeado): Promise<string> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: tenant.email,
        password: tenant.senha,
        tenantSlug: tenant.slug,
      },
    });
    expect(resposta.statusCode).toBe(200);
    return (resposta.json() as { accessToken: string }).accessToken;
  }

  async function cadastrarAtivo(
    token: string,
    code = 'ESC-014',
  ): Promise<AtivoJson> {
    const resposta = await requisicao({
      method: 'POST',
      url: '/api/v1/assets',
      token,
      payload: {
        code,
        name: 'Escavadeira 20t',
        category: 'escavadeira',
        serialNumber: 'SN-99',
      },
    });
    expect(resposta.statusCode).toBe(201);
    return resposta.json() as AtivoJson;
  }

  function bloquear(
    token: string,
    assetId: string,
    janela: { startsAt: string; endsAt: string },
    reason = 'reserved',
  ): Promise<RespostaHttp> {
    return requisicao({
      method: 'POST',
      url: '/api/v1/asset-holds',
      token,
      payload: { assetId, reason, ...janela },
    });
  }

  function comoMcp<T>(fn: () => Promise<T>): Promise<T> {
    const contexto = createContext('mcp');
    return runWithContext(contexto, () => {
      authenticateContext(contexto, {
        tenantId: toTenantId(empresa.tenantId),
        userId: toUserId(empresa.userId),
        actor: { kind: 'user', id: empresa.userId },
        permissions: ['*'],
        scopes: ['*'],
        entitlements: MODULOS,
      });
      return fn();
    });
  }

  const GRANT = { permissions: ['*'], scopes: ['*'], entitlements: MODULOS };

  /**
   * Troca o papel do vínculo por um de operador de pátio: bloqueia e libera
   * equipamento o dia inteiro, mas não cadastra nem dá baixa em patrimônio. É
   * por isso que `hold` e `retire` são permissões separadas, e não um
   * `assets.asset.manage` que faz tudo.
   */
  async function viraOperadorDePatio(tenant: TenantSemeado): Promise<void> {
    const roleId = randomUUID();
    await dono`
      insert into tenancy_roles (id, tenant_id, key, name)
      values (${roleId}, ${tenant.tenantId}, 'patio', 'Operação de pátio')
    `;
    for (const permissao of ['assets.asset.read', 'assets.asset.hold']) {
      await dono`
        insert into tenancy_role_permissions (role_id, tenant_id, permission)
        values (${roleId}, ${tenant.tenantId}, ${permissao})
      `;
    }
    await dono`
      delete from tenancy_membership_roles where membership_id = ${tenant.membershipId}
    `;
    await dono`
      insert into tenancy_membership_roles (membership_id, role_id, tenant_id)
      values (${tenant.membershipId}, ${roleId}, ${tenant.tenantId})
    `;
  }

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());

    process.env.DATABASE_URL = urlDaAplicacao();
    process.env.JWT_SECRET = 'segredo-de-teste-com-mais-de-32-bytes-1234';
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.NODE_ENV = 'test';

    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    registrarContextoDeRequisicao(app.getHttpAdapter().getInstance());
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    nucleo = app.get<NucleoDaPlataforma>(PLATFORM_CORE);
  });

  afterAll(async () => {
    await app?.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table assets_asset_holds, assets_assets cascade`;
    await limparDados(dono);

    empresa = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: MODULOS,
    });
    // Mesma plataforma, sem o módulo Ativos contratado.
    semAtivos = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: [],
    });
    operador = await semearTenant(dono, {
      slug: 'empresa-c',
      email: 'carlos@empresa-c.com.br',
      modulos: MODULOS,
    });
    await viraOperadorDePatio(operador);
  });

  describe('ciclo do equipamento: cadastro → bloqueio → liberação → baixa', () => {
    it('percorre o ciclo inteiro pela API', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);
      expect(maquina.availability).toBe('available');

      const bloqueio = await bloquear(token, maquina.id, {
        startsAt: daquiA(-1),
        endsAt: daquiA(10),
      });
      expect(bloqueio.statusCode).toBe(201);
      const criado = bloqueio.json() as BloqueioJson;
      expect(criado.open).toBe(true);

      const preso = await requisicao({
        method: 'GET',
        url: `/api/v1/assets/${maquina.id}`,
        token,
      });
      expect((preso.json() as AtivoJson).availability).toBe('held');

      const liberado = await requisicao({
        method: 'POST',
        url: `/api/v1/asset-holds/${criado.id}/release`,
        token,
      });
      expect(liberado.statusCode).toBe(200);
      expect((liberado.json() as BloqueioJson).open).toBe(false);

      const livre = await requisicao({
        method: 'GET',
        url: `/api/v1/assets/${maquina.id}`,
        token,
      });
      expect((livre.json() as AtivoJson).availability).toBe('available');

      const baixa = await requisicao({
        method: 'POST',
        url: `/api/v1/assets/${maquina.id}/retire`,
        token,
        payload: { reason: 'vendida em leilão' },
      });
      expect(baixa.statusCode).toBe(200);
      expect((baixa.json() as AtivoJson).availability).toBe('retired');
    });

    it('recusa código de patrimônio repetido', async () => {
      const token = await entrar(empresa);
      await cadastrarAtivo(token, 'ESC-014');

      const repetido = await requisicao({
        method: 'POST',
        url: '/api/v1/assets',
        token,
        payload: { code: 'ESC-014', name: 'Outra', category: 'escavadeira' },
      });
      expect(repetido.statusCode).toBe(409);
    });
  });

  describe('a disponibilidade é derivada, nunca guardada', () => {
    it('a MESMA linha responde livre hoje e ocupada na semana que vem', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);
      await bloquear(token, maquina.id, {
        startsAt: daquiA(10),
        endsAt: daquiA(20),
      });

      const hoje = await requisicao({
        method: 'GET',
        url: `/api/v1/assets/${maquina.id}`,
        token,
      });
      expect((hoje.json() as AtivoJson).availability).toBe('available');

      const noDia15 = await requisicao({
        method: 'GET',
        url: `/api/v1/assets?availability=available&em=${encodeURIComponent(daquiA(15))}`,
        token,
      });
      // Nenhuma rotina rodou entre as duas leituras. Se `availability` fosse
      // coluna, dependeria de um job para virar verdade — e mentiria até lá.
      expect((noDia15.json() as { total: number }).total).toBe(0);
    });

    it('responde se o equipamento cabe num período, e o que o ocupa', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);
      await bloquear(token, maquina.id, {
        startsAt: daquiA(10),
        endsAt: daquiA(20),
      });

      const durante = await requisicao({
        method: 'GET',
        url: `/api/v1/assets/${maquina.id}/availability?startsAt=${encodeURIComponent(daquiA(12))}&endsAt=${encodeURIComponent(daquiA(14))}`,
        token,
      });
      const depois = await requisicao({
        method: 'GET',
        url: `/api/v1/assets/${maquina.id}/availability?startsAt=${encodeURIComponent(daquiA(21))}&endsAt=${encodeURIComponent(daquiA(25))}`,
        token,
      });

      expect((durante.json() as DisponibilidadeJson).available).toBe(false);
      expect((durante.json() as DisponibilidadeJson).conflicts).toHaveLength(1);
      expect((depois.json() as DisponibilidadeJson).available).toBe(true);
    });
  });

  describe('dois compromissos sobre o mesmo equipamento', () => {
    it('recusa o segundo bloqueio no mesmo intervalo', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);
      await bloquear(token, maquina.id, {
        startsAt: daquiA(10),
        endsAt: daquiA(20),
      });

      const conflito = await bloquear(
        token,
        maquina.id,
        { startsAt: daquiA(15), endsAt: daquiA(25) },
        'maintenance',
      );
      expect(conflito.statusCode).toBe(409);
    });

    it('recusa baixa de equipamento que está com alguém', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);
      await bloquear(token, maquina.id, {
        startsAt: daquiA(-1),
        endsAt: daquiA(10),
      });

      const baixa = await requisicao({
        method: 'POST',
        url: `/api/v1/assets/${maquina.id}/retire`,
        token,
        payload: {},
      });
      expect(baixa.statusCode).toBe(409);
    });

    it('recusa período com fim antes do início', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);

      const invertido = await bloquear(token, maquina.id, {
        startsAt: daquiA(20),
        endsAt: daquiA(10),
      });
      expect(invertido.statusCode).toBe(400);
    });
  });

  describe('alçada: bloquear não é dar baixa', () => {
    it('o operador de pátio bloqueia, mas não baixa patrimônio', async () => {
      const tokenDono = await entrar(empresa);
      const maquina = await cadastrarAtivo(tokenDono);

      // O operador é de outra empresa: cadastra o ativo dele para agir.
      const tokenOperador = await entrar(operador);
      const podeLer = await requisicao({
        method: 'GET',
        url: '/api/v1/assets',
        token: tokenOperador,
      });
      expect(podeLer.statusCode).toBe(200);

      const naoPodeCadastrar = await requisicao({
        method: 'POST',
        url: '/api/v1/assets',
        token: tokenOperador,
        payload: { code: 'X-1', name: 'Qualquer', category: 'teste' },
      });
      expect(naoPodeCadastrar.statusCode).toBe(403);

      const naoPodeBaixar = await requisicao({
        method: 'POST',
        url: `/api/v1/assets/${maquina.id}/retire`,
        token: tokenOperador,
        payload: {},
      });
      // 403 pela permissão — nem chega a olhar se o ativo é de outra empresa.
      expect(naoPodeBaixar.statusCode).toBe(403);
    });

    it('as tools MCP do operador seguem a mesma alçada', async () => {
      const grant = await nucleo.tenancy.resolveUserAccess({
        tenantId: operador.tenantId,
        userId: operador.userId,
        scopes: ['*'],
      });
      const nomes = nucleo.mcp.toolsDe(grant).map((tool) => tool.name);

      expect(nomes).toContain('assets.asset.hold');
      expect(nomes).toContain('assets.asset.availability');
      // Descoberta e execução passam pela MESMA decisão: o que some da
      // listagem também não executa se o host adivinhar o nome.
      expect(nomes).not.toContain('assets.asset.retire');
      expect(nomes).not.toContain('assets.asset.register');
    });
  });

  describe('módulo contratado', () => {
    it('empresa sem Ativos não acessa a rota nem enxerga as tools', async () => {
      const token = await entrar(semAtivos);
      const rota = await requisicao({
        method: 'GET',
        url: '/api/v1/assets',
        token,
      });
      expect(rota.statusCode).toBe(403);

      const grant = await nucleo.tenancy.resolveUserAccess({
        tenantId: semAtivos.tenantId,
        userId: semAtivos.userId,
        scopes: ['*'],
      });
      const nomes = nucleo.mcp.toolsDe(grant).map((tool) => tool.name);
      expect(nomes.some((nome) => nome.startsWith('assets.'))).toBe(false);
    });
  });

  describe('REST e MCP executam o mesmo caso de uso', () => {
    it('a tool bloqueia e o REST enxerga o mesmo estado', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);

      const tool = nucleo.mcp.acharTool(GRANT, 'assets.asset.hold');
      const bloqueio = (await comoMcp(() =>
        tool.handle(
          {
            assetId: maquina.id,
            reason: 'maintenance',
            startsAt: daquiA(-1),
            endsAt: daquiA(5),
          } as never,
          { tenantId: empresa.tenantId, actorId: empresa.userId },
        ),
      )) as BloqueioJson;

      const pelaRota = await requisicao({
        method: 'GET',
        url: `/api/v1/assets/${maquina.id}`,
        token,
      });
      const lido = pelaRota.json() as AtivoJson;

      expect(lido.availability).toBe('held');
      expect(lido.currentHold?.id).toBe(bloqueio.id);
    });

    it('a tool respeita a MESMA recusa de sobreposição', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);
      await bloquear(token, maquina.id, {
        startsAt: daquiA(10),
        endsAt: daquiA(20),
      });

      const tool = nucleo.mcp.acharTool(GRANT, 'assets.asset.hold');
      await expect(
        comoMcp(() =>
          tool.handle(
            {
              assetId: maquina.id,
              reason: 'reserved',
              startsAt: daquiA(15),
              endsAt: daquiA(25),
            } as never,
            { tenantId: empresa.tenantId, actorId: empresa.userId },
          ),
        ),
      ).rejects.toThrow();
    });

    it('a tool de disponibilidade não aceita tenantId por parâmetro', async () => {
      const token = await entrar(empresa);
      const maquina = await cadastrarAtivo(token);

      const tool = nucleo.mcp.acharTool(GRANT, 'assets.asset.availability');
      // Mesmo mandando um tenant alheio na entrada, o escopo é o do contexto:
      // o schema descarta o campo e o handler nem o enxerga.
      const resposta = (await comoMcp(() =>
        tool.handle(
          {
            assetId: maquina.id,
            tenantId: semAtivos.tenantId,
            startsAt: daquiA(1),
            endsAt: daquiA(2),
          } as never,
          { tenantId: empresa.tenantId, actorId: empresa.userId },
        ),
      )) as DisponibilidadeJson;

      expect(resposta.available).toBe(true);
    });
  });

  describe('isolamento entre empresas', () => {
    it('o equipamento de uma empresa não existe para a outra', async () => {
      const tokenA = await entrar(empresa);
      const maquina = await cadastrarAtivo(tokenA);

      const tokenC = await entrar(operador);
      const busca = await requisicao({
        method: 'GET',
        url: `/api/v1/assets/${maquina.id}`,
        token: tokenC,
      });
      expect(busca.statusCode).toBe(404);
    });
  });
});
