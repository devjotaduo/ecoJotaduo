import { NoopAuditLogger } from '@ecojotaduo/audit';
import { NoopEventPublisher, type EventPublisher } from '@ecojotaduo/events';
import {
  createDatabase,
  DrizzleUnitOfWork,
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
import { toTenantId } from '@ecojotaduo/tenant-context';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { rentals } from '../src/adapters/persistence/schema';
import {
  AssetNotInThisTenantError,
  CancelRentalUseCase,
  ContractNotActiveError,
  ContractNotInThisTenantError,
  DrizzleRentalRepository,
  FinishRentalUseCase,
  RentalAlreadyStartedError,
  RentalOutsideContractTermError,
  ScheduleRentalUseCase,
  SearchRentalsUseCase,
  StartRentalUseCase,
  type AssetDirectory,
  type ContractDirectory,
  type ContratoDeLocacao,
} from '../src/index';

exigirBancoEmCI();

const SQLSTATE_UNICO = '23505';

const CONTRATO_ATIVO = '11111111-1111-4111-8111-111111111111';
const CONTRATO_RASCUNHO = '22222222-2222-4222-8222-222222222222';
const CONTRATO_VENCIDO = '33333333-3333-4333-8333-333333333333';
const CLIENTE = '44444444-4444-4444-8444-444444444444';
const EQUIPAMENTO = '55555555-5555-4555-8555-555555555555';

const daquiA = (dias: number) =>
  new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

/** Comportamentos que só aparecem contra o PostgreSQL de verdade. */
describe.skipIf(!temBancoDeTeste)('Operações (integração)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  let locacoes: DrizzleRentalRepository;
  let programar: ScheduleRentalUseCase;
  let retirar: StartRentalUseCase;
  let devolver: FinishRentalUseCase;
  let cancelar: CancelRentalUseCase;
  let pesquisar: SearchRentalsUseCase;
  let eventos: NoopEventPublisher;

  /** Reservas criadas no "patrimônio" e as que continuam abertas. */
  let reservas: string[];
  let liberadas: string[];

  /**
   * Diretório de contratos falso: só a empresa A tem contratos, cada um numa
   * situação. Operações não conhece as tabelas de Contratos — fala com a porta.
   */
  const contratos: ContractDirectory = {
    find: (tenantId, contractId) => {
      if (tenantId !== empresaA.tenantId) {
        return Promise.resolve(null);
      }
      const catalogo: Record<string, ContratoDeLocacao> = {
        [CONTRATO_ATIVO]: contrato(CONTRATO_ATIVO, 1, 'active'),
        [CONTRATO_RASCUNHO]: contrato(CONTRATO_RASCUNHO, 2, 'draft'),
        [CONTRATO_VENCIDO]: contrato(CONTRATO_VENCIDO, 3, 'expired'),
      };
      return Promise.resolve(catalogo[contractId] ?? null);
    },
  };

  function contrato(
    id: string,
    numero: number,
    status: string,
  ): ContratoDeLocacao {
    return {
      contractId: id,
      number: numero,
      customerId: CLIENTE,
      title: 'Locação de equipamentos',
      status,
      startsOn: daquiA(-30),
      endsOn: daquiA(90),
    };
  }

  /** Patrimônio falso, com a memória do que foi reservado e liberado. */
  const ativos: AssetDirectory = {
    find: (tenantId, assetId) =>
      Promise.resolve(
        tenantId === empresaA.tenantId && assetId === EQUIPAMENTO
          ? {
              assetId: EQUIPAMENTO,
              code: 'ESC-014',
              name: 'Escavadeira 20t',
              availability: 'available',
            }
          : null,
      ),
    reservar: () => {
      const holdId = randomUUID();
      reservas.push(holdId);
      return Promise.resolve({ holdId });
    },
    liberar: (_tenantId, holdId) => {
      liberadas.push(holdId);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });

    const audit = new NoopAuditLogger();
    // Unidade de trabalho REAL: é ela que faz gravação e evento caírem juntos.
    const uow = new DrizzleUnitOfWork(handle.db);
    eventos = new NoopEventPublisher();
    locacoes = new DrizzleRentalRepository(handle.db);
    programar = new ScheduleRentalUseCase(
      locacoes,
      contratos,
      ativos,
      uow,
      audit,
    );
    retirar = new StartRentalUseCase(locacoes, uow, eventos, audit);
    devolver = new FinishRentalUseCase(locacoes, ativos, uow, eventos, audit);
    cancelar = new CancelRentalUseCase(locacoes, ativos, uow, eventos, audit);
    pesquisar = new SearchRentalsUseCase(locacoes);
  });

  afterAll(async () => {
    await handle?.close();
    await dono.end({ timeout: 5 });
    await encerrarBanco?.();
  });

  beforeEach(async () => {
    await limparDados(dono);
    reservas = [];
    liberadas = [];
    eventos.eventos.length = 0;
    empresaA = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['contracts', 'assets', 'operations'],
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['contracts', 'assets', 'operations'],
    });
  });

  function novaLocacao(contractId = CONTRATO_ATIVO) {
    return programar.execute({
      tenantId: empresaA.tenantId,
      contractId,
      assetId: EQUIPAMENTO,
      startsAt: daquiA(1),
      endsAt: daquiA(10),
    });
  }

  describe('nasce de contrato em vigor', () => {
    it('copia o cliente do contrato e reserva o equipamento', async () => {
      const locacao = await novaLocacao();

      // Cliente NÃO foi informado: veio do contrato.
      expect(locacao.customerId).toBe(CLIENTE);
      expect(locacao.assetCode).toBe('ESC-014');
      expect(locacao.number).toBe(1);
      expect(locacao.status).toBe('scheduled');
      // A reserva no patrimônio é a garantia contra locação dupla.
      expect(reservas).toContain(locacao.holdId);
    });

    it('recusa contrato ainda em rascunho', async () => {
      await expect(novaLocacao(CONTRATO_RASCUNHO)).rejects.toThrow(
        ContractNotActiveError,
      );
      // Nada foi reservado: a recusa vem antes de tocar no patrimônio.
      expect(reservas).toHaveLength(0);
    });

    it('recusa contrato com vigência vencida', async () => {
      await expect(novaLocacao(CONTRATO_VENCIDO)).rejects.toThrow(
        ContractNotActiveError,
      );
    });

    it('recusa contrato de outra empresa', async () => {
      await expect(
        programar.execute({
          tenantId: empresaB.tenantId,
          contractId: CONTRATO_ATIVO,
          assetId: EQUIPAMENTO,
          startsAt: daquiA(1),
          endsAt: daquiA(10),
        }),
      ).rejects.toThrow(ContractNotInThisTenantError);
    });

    it('recusa equipamento de outra empresa', async () => {
      await expect(
        programar.execute({
          tenantId: empresaA.tenantId,
          contractId: CONTRATO_ATIVO,
          assetId: randomUUID(),
          startsAt: daquiA(1),
          endsAt: daquiA(10),
        }),
      ).rejects.toThrow(AssetNotInThisTenantError);
    });
  });

  describe('a locação cabe dentro da vigência do contrato', () => {
    it('recusa devolução prevista depois do fim do contrato', async () => {
      // Equipamento na rua fora da vigência não tem o que o cubra.
      await expect(
        programar.execute({
          tenantId: empresaA.tenantId,
          contractId: CONTRATO_ATIVO,
          assetId: EQUIPAMENTO,
          startsAt: daquiA(1),
          endsAt: daquiA(120),
        }),
      ).rejects.toThrow(RentalOutsideContractTermError);
      expect(reservas).toHaveLength(0);
    });

    it('recusa retirada antes do início do contrato', async () => {
      await expect(
        programar.execute({
          tenantId: empresaA.tenantId,
          contractId: CONTRATO_ATIVO,
          assetId: EQUIPAMENTO,
          startsAt: daquiA(-60),
          endsAt: daquiA(10),
        }),
      ).rejects.toThrow(RentalOutsideContractTermError);
    });
  });

  describe('a reserva acompanha o ciclo', () => {
    it('devolver libera o equipamento no pátio', async () => {
      const locacao = await novaLocacao();
      await retirar.execute({
        tenantId: empresaA.tenantId,
        rentalId: locacao.id,
      });
      await devolver.execute({
        tenantId: empresaA.tenantId,
        rentalId: locacao.id,
        reason: 'equipamento em ordem',
      });

      // Devolver adiantado não deixa o equipamento parado até a data prevista.
      expect(liberadas).toEqual([locacao.holdId]);
      const relida = await locacoes.findById(empresaA.tenantId, locacao.id);
      expect(relida?.status).toBe('finished');
    });

    it('cancelar libera o equipamento', async () => {
      const locacao = await novaLocacao();
      await cancelar.execute({
        tenantId: empresaA.tenantId,
        rentalId: locacao.id,
        reason: 'cliente desistiu',
      });

      expect(liberadas).toEqual([locacao.holdId]);
    });

    it('não cancela depois que o equipamento saiu', async () => {
      const locacao = await novaLocacao();
      await retirar.execute({
        tenantId: empresaA.tenantId,
        rentalId: locacao.id,
      });

      await expect(
        cancelar.execute({
          tenantId: empresaA.tenantId,
          rentalId: locacao.id,
        }),
      ).rejects.toThrow(RentalAlreadyStartedError);
      // E o equipamento continua preso, que é o correto: ele está com o cliente.
      expect(liberadas).toHaveLength(0);
    });

    it('gravação e evento caem juntos quando o evento falha', async () => {
      // Sem a unidade de trabalho, a locação ficaria gravada e o consumidor
      // nunca saberia dela — ou pior, o inverso.
      const publisherQuebrado: EventPublisher = {
        publish: () => Promise.reject(new Error('outbox fora do ar')),
      };
      const devolverQuebrado = new FinishRentalUseCase(
        locacoes,
        ativos,
        new DrizzleUnitOfWork(handle.db),
        publisherQuebrado,
        new NoopAuditLogger(),
      );

      const locacao = await novaLocacao();
      await retirar.execute({
        tenantId: empresaA.tenantId,
        rentalId: locacao.id,
      });

      await expect(
        devolverQuebrado.execute({
          tenantId: empresaA.tenantId,
          rentalId: locacao.id,
        }),
      ).rejects.toThrow('outbox fora do ar');

      // A devolução NÃO foi gravada: o rollback levou tudo.
      const relida = await locacoes.findById(empresaA.tenantId, locacao.id);
      expect(relida?.status).toBe('active');
    });

    it('publica o fato de negócio a cada transição', async () => {
      const locacao = await novaLocacao();
      await retirar.execute({
        tenantId: empresaA.tenantId,
        rentalId: locacao.id,
      });
      await devolver.execute({
        tenantId: empresaA.tenantId,
        rentalId: locacao.id,
      });

      expect(eventos.eventos.map((evento) => evento.type)).toEqual([
        'operations.rental.started.v1',
        'operations.rental.finished.v1',
      ]);
    });

    it('uma reserva serve a UMA locação — a restrição do banco garante', async () => {
      // Se duas locações apontassem para o mesmo bloqueio, devolver uma
      // soltaria o equipamento que a outra ainda usa.
      const locacao = await novaLocacao();
      const erro = await inserirLocacaoDireta(empresaA.tenantId, {
        tenantId: empresaA.tenantId,
        holdId: locacao.holdId,
        number: 99,
      }).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_UNICO);
    });
  });

  describe('atraso filtrado no banco', () => {
    it('traz só as em andamento com prazo vencido', async () => {
      const noPrazo = await novaLocacao();
      await retirar.execute({
        tenantId: empresaA.tenantId,
        rentalId: noPrazo.id,
      });

      // Uma locação que já venceu: gravada direto, porque o caso de uso (com
      // razão) recusa programar no passado.
      const vencida = await inserirLocacaoDireta(empresaA.tenantId, {
        tenantId: empresaA.tenantId,
        holdId: randomUUID(),
        number: 50,
        status: 'active',
        startsAt: daquiA(-20),
        endsAt: daquiA(-2),
      });

      const atrasadas = await pesquisar.execute({
        tenantId: empresaA.tenantId,
        atrasadas: true,
        limit: 20,
        offset: 0,
      });

      expect(atrasadas.total).toBe(1);
      expect(atrasadas.items[0]?.id).toBe(vencida);
      expect(atrasadas.items[0]?.situacao()).toBe('overdue');
      expect(atrasadas.items[0]?.diasDeAtraso()).toBeGreaterThanOrEqual(2);
    });
  });

  describe('numeração', () => {
    it('numera por empresa, sem repetir', async () => {
      const primeira = await novaLocacao();
      await devolver
        .execute({ tenantId: empresaA.tenantId, rentalId: primeira.id })
        .catch(() => undefined);
      const segunda = await novaLocacao();

      expect(primeira.number).toBe(1);
      expect(segunda.number).toBe(2);
    });
  });

  describe('isolamento entre empresas', () => {
    it('a locação de A não aparece na pesquisa de B', async () => {
      await novaLocacao();
      const daOutra = await pesquisar.execute({
        tenantId: empresaB.tenantId,
        limit: 20,
        offset: 0,
      });
      expect(daOutra.total).toBe(0);
    });

    it('nem com o id em mãos', async () => {
      const locacao = await novaLocacao();
      expect(await locacoes.findById(empresaB.tenantId, locacao.id)).toBeNull();
    });

    it('a RLS barra a leitura mesmo em consulta sem filtro de tenant', async () => {
      // De propósito sem `where tenant_id`: é o que sobra quando o código erra.
      await novaLocacao();
      const doPontoDeVistaDeB = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) => tx.select().from(rentals),
      );
      expect(doPontoDeVistaDeB).toHaveLength(0);
    });

    it('a RLS barra a ESCRITA de linha de outra empresa', async () => {
      const erro = await inserirLocacaoDireta(empresaB.tenantId, {
        tenantId: empresaA.tenantId,
        holdId: randomUUID(),
        number: 999,
      }).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_RLS);
    });
  });

  /** Escrita direta, sem passar pelo caso de uso: exercita o banco. */
  async function inserirLocacaoDireta(
    escopo: string,
    linha: {
      tenantId: string;
      holdId: string;
      number: number;
      status?: string;
      startsAt?: Date;
      endsAt?: Date;
    },
  ): Promise<string> {
    const id = randomUUID();
    const agora = new Date();
    await withTenant(handle.db, { tenantId: toTenantId(escopo) }, (tx) =>
      tx.insert(rentals).values({
        id,
        tenantId: linha.tenantId,
        number: linha.number,
        contractId: CONTRATO_ATIVO,
        customerId: CLIENTE,
        assetId: EQUIPAMENTO,
        assetCode: 'ESC-014',
        holdId: linha.holdId,
        status: linha.status ?? 'scheduled',
        startsAt: linha.startsAt ?? daquiA(1),
        endsAt: linha.endsAt ?? daquiA(10),
        notes: null,
        createdAt: agora,
        updatedAt: agora,
        startedAt: null,
        finishedAt: null,
        canceledAt: null,
        closeReason: null,
      }),
    );
    return id;
  }
});
