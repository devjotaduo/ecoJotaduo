import {
  comUnidadeDeTrabalho,
  createDatabase,
  EscopoCruzadoError,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@ecojotaduo/database';
import {
  codigoPostgres,
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  prepararBancoDeTestes,
  semearTenant,
  SQLSTATE_RLS,
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
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OutboxDispatcher } from '../src/dispatcher';
import { DrizzleEventPublisher, DrizzleOutbox, outbox } from '../src/drizzle';
import type { EventHandler, IntegrationEvent } from '../src/index';

exigirBancoEmCI();

/** Handler de teste: registra o que recebeu e pode ser mandado falhar. */
class HandlerEspiao implements EventHandler {
  readonly recebidos: IntegrationEvent[] = [];
  falhar = false;

  constructor(
    readonly name: string,
    readonly eventTypes: readonly string[],
  ) {}

  handle(evento: IntegrationEvent): Promise<void> {
    if (this.falhar) {
      return Promise.reject(new Error(`${this.name} indisponível`));
    }
    this.recebidos.push(evento);
    return Promise.resolve();
  }
}

describe.skipIf(!temBancoDeTeste)('Outbox transacional (integração)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  let publisher: DrizzleEventPublisher;
  let repositorio: DrizzleOutbox;

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });

    publisher = new DrizzleEventPublisher(handle.db);
    repositorio = new DrizzleOutbox(handle.db);
  });

  afterAll(async () => {
    await handle?.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await limparDados(dono);
    empresaA = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
    });
  });

  /** Roda `fn` autenticada na empresa, como uma requisição REST faria. */
  function como<T>(tenant: TenantSemeado, fn: () => Promise<T>): Promise<T> {
    const contexto = createContext('rest');
    return runWithContext(contexto, () => {
      authenticateContext(contexto, {
        tenantId: toTenantId(tenant.tenantId),
        userId: toUserId(tenant.userId),
        actor: { kind: 'user', id: tenant.userId },
        permissions: ['*'],
        scopes: ['*'],
        entitlements: [],
      });
      return fn();
    });
  }

  /**
   * "Grava um dado de negócio". `audit_events` serve de cobaia por ser uma
   * tabela de plataforma real, com RLS — o ponto do teste é haver DUAS
   * tabelas diferentes na mesma transação.
   */
  async function gravarDado(tenant: TenantSemeado, acao: string) {
    await withTenant(
      handle.db,
      {
        tenantId: toTenantId(tenant.tenantId),
        userId: toUserId(tenant.userId),
      },
      (tx) =>
        tx.execute(sql`
          insert into audit_events
            (id, tenant_id, actor_kind, actor_id, channel, action, result, correlation_id)
          values (${randomUUID()}, ${tenant.tenantId}, 'user', ${tenant.userId},
                  'rest', ${acao}, 'success', ${randomUUID()})
        `),
    );
  }

  const contarDados = async (tenant: TenantSemeado, acao: string) => {
    const linhas = await dono<{ total: number }[]>`
      select count(*)::int as total from audit_events
      where tenant_id = ${tenant.tenantId} and action = ${acao}
    `;
    return linhas[0]?.total ?? 0;
  };

  const contarEventos = async (tenant: TenantSemeado) => {
    const linhas = await dono<{ total: number }[]>`
      select count(*)::int as total from platform_outbox where tenant_id = ${tenant.tenantId}
    `;
    return linhas[0]?.total ?? 0;
  };

  describe('o dado e o evento vão juntos, ou não vão', () => {
    it('unidade de trabalho grava os dois de uma vez', async () => {
      await como(empresaA, () =>
        comUnidadeDeTrabalho(
          handle.db,
          { tenantId: toTenantId(empresaA.tenantId) },
          async () => {
            await gravarDado(empresaA, 'teste.criado');
            await publisher.publish({
              type: 'teste.coisa.criada.v1',
              resourceId: 'r-1',
              payload: { valor: 42 },
            });
          },
        ),
      );

      expect(await contarDados(empresaA, 'teste.criado')).toBe(1);
      expect(await contarEventos(empresaA)).toBe(1);
    });

    it('se a gravação falhar DEPOIS de publicar, o evento não sobra', async () => {
      // Sem a unidade, o outbox teria um fato que nunca aconteceu — e algum
      // consumidor agiria sobre ele.
      await expect(
        como(empresaA, () =>
          comUnidadeDeTrabalho(
            handle.db,
            { tenantId: toTenantId(empresaA.tenantId) },
            async () => {
              await publisher.publish({ type: 'teste.coisa.criada.v1' });
              await gravarDado(empresaA, 'teste.criado');
              throw new Error('regra de negócio falhou depois');
            },
          ),
        ),
      ).rejects.toThrow('regra de negócio falhou depois');

      expect(await contarEventos(empresaA)).toBe(0);
      expect(await contarDados(empresaA, 'teste.criado')).toBe(0);
    });

    it('se o publish falhar, o dado também volta atrás', async () => {
      await expect(
        como(empresaA, () =>
          comUnidadeDeTrabalho(
            handle.db,
            { tenantId: toTenantId(empresaA.tenantId) },
            async () => {
              await gravarDado(empresaA, 'teste.criado');
              // Tipo nulo viola `not null` — falha vinda do banco, não do teste.
              await publisher.publish({ type: null as unknown as string });
            },
          ),
        ),
      ).rejects.toThrow();

      expect(await contarDados(empresaA, 'teste.criado')).toBe(0);
    });

    it('FORA da unidade, cada escrita tem o próprio destino', async () => {
      // É o comportamento de antes, e continua válido para quem não precisa
      // de atomicidade: o `withTenant` só reusa transação dentro da unidade.
      await como(empresaA, async () => {
        await gravarDado(empresaA, 'teste.solto');
        await publisher.publish({ type: 'teste.solto.v1' });
      });

      expect(await contarDados(empresaA, 'teste.solto')).toBe(1);
      expect(await contarEventos(empresaA)).toBe(1);
    });

    it('uma unidade pertence a UMA empresa', async () => {
      // Reusar a transação para outra empresa gravaria com `app.tenant_id`
      // fixado na primeira — é defeito, e falha alto em vez de em silêncio.
      await expect(
        como(empresaA, () =>
          comUnidadeDeTrabalho(
            handle.db,
            { tenantId: toTenantId(empresaA.tenantId) },
            () => gravarDado(empresaB, 'invasor'),
          ),
        ),
      ).rejects.toThrow(EscopoCruzadoError);
    });
  });

  describe('entrega', () => {
    async function publicar(tenant: TenantSemeado, tipo: string) {
      await como(tenant, () => publisher.publish({ type: tipo, payload: {} }));
    }

    it('entrega ao handler que assina o tipo e fecha o evento', async () => {
      const espiao = new HandlerEspiao('espiao', ['teste.coisa.criada.v1']);
      const outro = new HandlerEspiao('outro', ['nada.a.ver.v1']);
      const dispatcher = new OutboxDispatcher(repositorio, [espiao, outro]);

      await publicar(empresaA, 'teste.coisa.criada.v1');
      const resumo = await dispatcher.processarCiclo();

      expect(resumo.entregues).toBe(1);
      expect(espiao.recebidos).toHaveLength(1);
      expect(espiao.recebidos[0]?.tenantId).toBe(empresaA.tenantId);
      // Quem não assina o tipo não recebe.
      expect(outro.recebidos).toHaveLength(0);
    });

    it('assinatura por prefixo com `*`', async () => {
      const espiao = new HandlerEspiao('prefixo', ['teste.*']);
      const dispatcher = new OutboxDispatcher(repositorio, [espiao]);

      await publicar(empresaA, 'teste.coisa.criada.v1');
      await dispatcher.processarCiclo();

      expect(espiao.recebidos).toHaveLength(1);
    });

    it('handler que falha adia o evento, sem derrubar o ciclo', async () => {
      const quebrado = new HandlerEspiao('quebrado', ['teste.*']);
      quebrado.falhar = true;
      const dispatcher = new OutboxDispatcher(repositorio, [quebrado]);

      await publicar(empresaA, 'teste.coisa.criada.v1');
      const resumo = await dispatcher.processarCiclo();

      expect(resumo.falhados).toBe(1);
      const [linha] = await dono<
        {
          status: string;
          attempts: number;
          available_at: Date;
          last_error: string;
        }[]
      >`select status, attempts, available_at, last_error from platform_outbox where tenant_id = ${empresaA.tenantId}`;
      expect(linha?.status).toBe('pending');
      expect(linha?.attempts).toBe(1);
      expect(linha?.last_error).toContain('quebrado indisponível');
      // Adiado para o futuro: o próximo ciclo não o pega de imediato.
      expect(linha!.available_at.getTime()).toBeGreaterThan(Date.now());
    });

    it('o retry NÃO repete o handler que já tinha dado certo', async () => {
      const bom = new HandlerEspiao('bom', ['teste.*']);
      const ruim = new HandlerEspiao('ruim', ['teste.*']);
      ruim.falhar = true;
      const dispatcher = new OutboxDispatcher(repositorio, [bom, ruim], {
        backoffBaseMs: 0,
      });

      await publicar(empresaA, 'teste.coisa.criada.v1');
      await dispatcher.processarCiclo();
      expect(bom.recebidos).toHaveLength(1);

      // Segundo ciclo: o `ruim` volta a ser tentado, o `bom` não.
      ruim.falhar = false;
      await dispatcher.processarCiclo();

      expect(bom.recebidos).toHaveLength(1);
      expect(ruim.recebidos).toHaveLength(1);
      const [linha] = await dono<{ status: string }[]>`
        select status from platform_outbox where tenant_id = ${empresaA.tenantId}
      `;
      expect(linha?.status).toBe('delivered');
    });

    it('esgotadas as tentativas, o evento morre na DLQ e pode ser revivido', async () => {
      const quebrado = new HandlerEspiao('quebrado', ['teste.*']);
      quebrado.falhar = true;
      const dispatcher = new OutboxDispatcher(repositorio, [quebrado], {
        maximoDeTentativas: 2,
        backoffBaseMs: 0,
      });

      await publicar(empresaA, 'teste.coisa.criada.v1');
      await dispatcher.processarCiclo();
      const resumo = await dispatcher.processarCiclo();
      expect(resumo.mortos).toBe(1);

      const [morto] = await dono<{ id: string; status: string }[]>`
        select id, status from platform_outbox where tenant_id = ${empresaA.tenantId}
      `;
      expect(morto?.status).toBe('dead');
      // Morto não volta a ser tentado sozinho.
      expect((await dispatcher.processarCiclo()).entregues).toBe(0);

      // Replay: consertada a integração, o evento volta para a fila.
      quebrado.falhar = false;
      expect(await repositorio.reviver(empresaA.tenantId, morto!.id)).toBe(
        true,
      );
      expect((await dispatcher.processarCiclo()).entregues).toBe(1);
      expect(quebrado.recebidos).toHaveLength(1);
    });

    it('o backoff cresce a cada falha', async () => {
      const quebrado = new HandlerEspiao('quebrado', ['teste.*']);
      quebrado.falhar = true;
      const dispatcher = new OutboxDispatcher(repositorio, [quebrado], {
        backoffBaseMs: 10_000,
      });

      await publicar(empresaA, 'teste.coisa.criada.v1');
      await dispatcher.processarCiclo();
      const primeiro = await esperaAtual();

      // Força a elegibilidade para exercitar a segunda falha.
      await dono`update platform_outbox set available_at = now() where tenant_id = ${empresaA.tenantId}`;
      await dispatcher.processarCiclo();
      const segundo = await esperaAtual();

      expect(segundo).toBeGreaterThan(primeiro);
    });

    /**
     * Quanto falta para o evento voltar à fila, medido INTEIRAMENTE pelo
     * relógio do banco. Comparar `available_at` com `Date.now()` misturava os
     * dois relógios e falhava por alguns milissegundos de desvio — o mesmo
     * defeito que existia no `lote()` e valia em produção, não só no teste.
     */
    async function esperaAtual(): Promise<number> {
      const [linha] = await dono<{ ms: number }[]>`
        select extract(epoch from (available_at - now())) * 1000 as ms
        from platform_outbox where tenant_id = ${empresaA.tenantId}
      `;
      return Number(linha!.ms);
    }
  });

  describe('descoberta de trabalho entre empresas', () => {
    it('só lista quem tem evento pendente e já elegível', async () => {
      await como(empresaA, () => publisher.publish({ type: 'teste.a.v1' }));

      const comPendencia = await repositorio.tenantsComPendencia();
      expect(comPendencia).toContain(empresaA.tenantId);
      expect(comPendencia).not.toContain(empresaB.tenantId);
    });

    it('a função devolve apenas identificadores, nunca conteúdo', async () => {
      // É o que torna aceitável ela rodar como dono: mesmo se vazasse, não há
      // payload de negócio no retorno.
      await como(empresaA, () =>
        publisher.publish({ type: 'teste.a.v1', payload: { segredo: 'x' } }),
      );
      const colunas = await dono<{ campo: string }[]>`
        select unnest(string_to_array(pg_get_function_result(p.oid), ' ')) as campo
        from pg_proc p where p.proname = 'platform_outbox_pending_tenants'
      `;
      expect(colunas.map((c) => c.campo)).toContain('uuid');
    });

    it('evento adiado some da lista até a hora chegar', async () => {
      await como(empresaA, () => publisher.publish({ type: 'teste.a.v1' }));
      await dono`update platform_outbox set available_at = now() + interval '1 hour' where tenant_id = ${empresaA.tenantId}`;

      expect(await repositorio.tenantsComPendencia()).not.toContain(
        empresaA.tenantId,
      );
    });
  });

  describe('isolamento entre empresas', () => {
    it('o evento de A não é visível no escopo de B', async () => {
      await como(empresaA, () => publisher.publish({ type: 'teste.a.v1' }));

      const doPontoDeVistaDeB = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) => tx.select().from(outbox),
      );
      expect(doPontoDeVistaDeB).toHaveLength(0);
    });

    it('a RLS barra a ESCRITA de evento em nome de outra empresa', async () => {
      const erro = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) =>
          tx
            .insert(outbox)
            .values({
              id: randomUUID(),
              tenantId: empresaA.tenantId,
              type: 'invasor.v1',
              payload: {},
              occurredAt: new Date(),
              availableAt: new Date(),
              deliveredTo: [],
            })
            .then(() => null),
      ).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_RLS);
    });

    it('o dispatcher entrega cada evento no escopo da empresa dona', async () => {
      const espiao = new HandlerEspiao('espiao', ['teste.*']);
      const dispatcher = new OutboxDispatcher(repositorio, [espiao]);

      await como(empresaA, () => publisher.publish({ type: 'teste.a.v1' }));
      await como(empresaB, () => publisher.publish({ type: 'teste.b.v1' }));
      await dispatcher.processarCiclo();

      const porTenant = espiao.recebidos.map((evento) => evento.tenantId);
      expect(porTenant).toContain(empresaA.tenantId);
      expect(porTenant).toContain(empresaB.tenantId);
      expect(espiao.recebidos).toHaveLength(2);
    });
  });
});
