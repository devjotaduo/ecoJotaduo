import { NoopAuditLogger } from '@ecojotaduo/audit';
import {
  createDatabase,
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

import { assetHolds, assets } from '../src/adapters/persistence/schema';
import {
  AssetHeldError,
  AssetInUseError,
  AssetRetiredError,
  AssetsService,
  CheckAvailabilityUseCase,
  DrizzleAssetHoldRepository,
  DrizzleAssetRepository,
  DuplicateAssetCodeError,
  GetAssetUseCase,
  HoldAssetUseCase,
  RegisterAssetUseCase,
  ReleaseHoldUseCase,
  RetireAssetUseCase,
  SearchAssetsUseCase,
} from '../src/index';

exigirBancoEmCI();

/** `exclusion_violation`: a restrição GiST recusou o período sobreposto. */
const SQLSTATE_EXCLUSAO = '23P01';
/** `unique_violation`. */
const SQLSTATE_UNICO = '23505';

const daquiA = (dias: number) =>
  new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

/** Comportamentos que só aparecem contra o PostgreSQL de verdade. */
describe.skipIf(!temBancoDeTeste)('Ativos (integração)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  let ativos: DrizzleAssetRepository;
  let bloqueiosRepo: DrizzleAssetHoldRepository;
  let cadastrar: RegisterAssetUseCase;
  let obter: GetAssetUseCase;
  let pesquisar: SearchAssetsUseCase;
  let bloquear: HoldAssetUseCase;
  let liberar: ReleaseHoldUseCase;
  let baixar: RetireAssetUseCase;
  let disponibilidade: CheckAvailabilityUseCase;
  let superficiePublica: AssetsService;

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });

    const audit = new NoopAuditLogger();
    ativos = new DrizzleAssetRepository(handle.db);
    bloqueiosRepo = new DrizzleAssetHoldRepository(handle.db);
    cadastrar = new RegisterAssetUseCase(ativos, audit);
    obter = new GetAssetUseCase(ativos, bloqueiosRepo);
    pesquisar = new SearchAssetsUseCase(ativos, bloqueiosRepo);
    bloquear = new HoldAssetUseCase(ativos, bloqueiosRepo, audit);
    liberar = new ReleaseHoldUseCase(bloqueiosRepo, audit);
    baixar = new RetireAssetUseCase(ativos, bloqueiosRepo, audit);
    disponibilidade = new CheckAvailabilityUseCase(ativos, bloqueiosRepo);
    superficiePublica = new AssetsService(
      ativos,
      bloqueiosRepo,
      bloquear,
      liberar,
    );
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
      modulos: ['assets'],
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['assets'],
    });
  });

  function novoAtivo(code = 'ESC-014', tenantId = empresaA.tenantId) {
    return cadastrar.execute({
      tenantId,
      code,
      name: 'Escavadeira 20t',
      category: 'escavadeira',
    });
  }

  describe('cadastro', () => {
    it('nasce disponível, porque não há bloqueio nenhum sobre ele', async () => {
      const maquina = await novoAtivo();
      const lido = await obter.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
      });

      expect(lido.availability).toBe('available');
      expect(lido.currentHold).toBeNull();
    });

    it('recusa código repetido na mesma empresa', async () => {
      await novoAtivo('ESC-014');
      await expect(novoAtivo('ESC-014')).rejects.toThrow(
        DuplicateAssetCodeError,
      );
    });

    it('o mesmo código em OUTRA empresa é outro equipamento', async () => {
      await novoAtivo('ESC-014', empresaA.tenantId);
      const daOutra = await novoAtivo('ESC-014', empresaB.tenantId);
      expect(daOutra.code).toBe('ESC-014');
    });

    it('a restrição do banco é a rede de baixo do código único', async () => {
      // Se dois cadastros passassem pela verificação ao mesmo tempo, é aqui
      // que o segundo morre.
      const maquina = await novoAtivo('ESC-014');
      const erro = await inserirAtivoDireto(empresaA.tenantId, {
        id: randomUUID(),
        tenantId: empresaA.tenantId,
        code: maquina.code,
      }).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_UNICO);
    });
  });

  describe('bloqueio e sobreposição', () => {
    it('bloqueia e a leitura passa a mostrar o ativo preso', async () => {
      const maquina = await novoAtivo();
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'maintenance',
        startsAt: daquiA(-1),
        endsAt: daquiA(5),
      });

      const lido = await obter.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
      });
      expect(lido.availability).toBe('held');
      expect(lido.currentHold?.reason).toBe('maintenance');
    });

    it('recusa segundo bloqueio no mesmo intervalo', async () => {
      const maquina = await novoAtivo();
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(10),
        endsAt: daquiA(20),
      });

      await expect(
        bloquear.execute({
          tenantId: empresaA.tenantId,
          assetId: maquina.id,
          reason: 'maintenance',
          startsAt: daquiA(15),
          endsAt: daquiA(25),
        }),
      ).rejects.toThrow(AssetHeldError);
    });

    it('bloqueios que apenas encostam convivem', async () => {
      // O fim de um é o início do outro: devolver às 12h e entregar às 12h.
      const maquina = await novoAtivo();
      const limite = daquiA(20);
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(10),
        endsAt: limite,
      });
      const segundo = await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'maintenance',
        startsAt: limite,
        endsAt: daquiA(25),
      });

      expect(segundo.id).toBeDefined();
    });

    it('a RESTRIÇÃO DE EXCLUSÃO barra a corrida que a verificação não pega', async () => {
      // Duas reservas simultâneas leem "livre" e as duas gravam. Sem esta
      // restrição, o conflito só apareceria no dia da entrega, com dois
      // clientes esperando o mesmo equipamento.
      const maquina = await novoAtivo();
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(10),
        endsAt: daquiA(20),
      });

      const erro = await inserirBloqueioDireto(empresaA.tenantId, {
        assetId: maquina.id,
        startsAt: daquiA(15),
        endsAt: daquiA(25),
      }).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_EXCLUSAO);
    });

    it('ativos diferentes não disputam o mesmo intervalo', async () => {
      const primeira = await novoAtivo('ESC-014');
      const segunda = await novoAtivo('ESC-015');
      const janela = { startsAt: daquiA(10), endsAt: daquiA(20) };

      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: primeira.id,
        reason: 'reserved',
        ...janela,
      });
      const outro = await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: segunda.id,
        reason: 'reserved',
        ...janela,
      });

      expect(outro.assetId).toBe(segunda.id);
    });

    it('ativo baixado não aceita bloqueio', async () => {
      const maquina = await novoAtivo();
      await baixar.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'vendida',
      });

      await expect(
        bloquear.execute({
          tenantId: empresaA.tenantId,
          assetId: maquina.id,
          reason: 'reserved',
          startsAt: daquiA(1),
          endsAt: daquiA(2),
        }),
      ).rejects.toThrow(AssetRetiredError);
    });
  });

  describe('liberação', () => {
    it('libera o período para outro compromisso, no banco também', async () => {
      const maquina = await novoAtivo();
      const reserva = await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(-1),
        endsAt: daquiA(30),
      });

      await liberar.execute({
        tenantId: empresaA.tenantId,
        holdId: reserva.id,
      });

      // O intervalo que sobrou é livre — inclusive para a restrição de
      // exclusão, que é quem tem a palavra final.
      const novo = await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'maintenance',
        startsAt: daquiA(5),
        endsAt: daquiA(30),
      });

      expect(novo.id).toBeDefined();
      const lido = await obter.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
      });
      // O bloqueio liberado continua no histórico: liberar não apaga.
      expect(lido.history).toHaveLength(2);
      expect(lido.availability).toBe('available');
    });

    it('cancelar um compromisso FUTURO devolve a janela inteira', async () => {
      // Este é o caso que a expressão `greatest` da restrição protege: com o
      // fim efetivo antes do início, `tstzrange` seria um intervalo invertido
      // e o PostgreSQL recusaria a linha com erro de faixa. Com `greatest`, o
      // intervalo fica vazio — e vazio não disputa nada.
      const maquina = await novoAtivo();
      const reserva = await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(30),
        endsAt: daquiA(40),
      });

      await liberar.execute({
        tenantId: empresaA.tenantId,
        holdId: reserva.id,
      });

      const outroCliente = await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(30),
        endsAt: daquiA(40),
      });

      expect(outroCliente.id).not.toBe(reserva.id);
      // O cancelado continua no histórico, com o período que fora combinado.
      const lido = await obter.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
      });
      expect(lido.history).toHaveLength(2);
    });
  });

  describe('baixa', () => {
    it('recusa enquanto houver bloqueio em vigor agora', async () => {
      const maquina = await novoAtivo();
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'damaged',
        startsAt: daquiA(-1),
        endsAt: daquiA(5),
      });

      await expect(
        baixar.execute({ tenantId: empresaA.tenantId, assetId: maquina.id }),
      ).rejects.toThrow(AssetInUseError);
    });

    it('bloqueio FUTURO não impede a baixa', async () => {
      // O equipamento está no pátio hoje; o compromisso ainda nem começou.
      const maquina = await novoAtivo();
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(30),
        endsAt: daquiA(40),
      });

      const baixada = await baixar.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
      });
      expect(baixada.status).toBe('retired');
    });
  });

  describe('disponibilidade no período', () => {
    it('responde livre, e responde quem ocupa', async () => {
      const maquina = await novoAtivo();
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(10),
        endsAt: daquiA(20),
      });

      const durante = await disponibilidade.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        startsAt: daquiA(12),
        endsAt: daquiA(14),
      });
      const depois = await disponibilidade.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        startsAt: daquiA(21),
        endsAt: daquiA(25),
      });

      expect(durante.available).toBe(false);
      expect(durante.conflicts).toHaveLength(1);
      expect(depois.available).toBe(true);
    });

    it('ativo baixado nunca fica disponível, nem no futuro', async () => {
      const maquina = await novoAtivo();
      await baixar.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
      });

      const resposta = await disponibilidade.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        startsAt: daquiA(100),
        endsAt: daquiA(110),
      });
      expect(resposta.available).toBe(false);
    });
  });

  describe('busca com disponibilidade filtrada no banco', () => {
    it('separa disponíveis, presos e baixados', async () => {
      const livre = await novoAtivo('ESC-001');
      const presa = await novoAtivo('ESC-002');
      const baixada = await novoAtivo('ESC-003');

      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: presa.id,
        reason: 'maintenance',
        startsAt: daquiA(-1),
        endsAt: daquiA(5),
      });
      await baixar.execute({
        tenantId: empresaA.tenantId,
        assetId: baixada.id,
      });

      const disponiveis = await pesquisar.execute({
        tenantId: empresaA.tenantId,
        availability: 'available',
        limit: 20,
        offset: 0,
      });
      const presos = await pesquisar.execute({
        tenantId: empresaA.tenantId,
        availability: 'held',
        limit: 20,
        offset: 0,
      });
      const baixados = await pesquisar.execute({
        tenantId: empresaA.tenantId,
        availability: 'retired',
        limit: 20,
        offset: 0,
      });

      // O total é do BANCO: filtrar depois de paginar faria a contagem mentir.
      expect(disponiveis.total).toBe(1);
      expect(disponiveis.items[0]?.asset.id).toBe(livre.id);
      expect(presos.total).toBe(1);
      expect(presos.items[0]?.asset.id).toBe(presa.id);
      expect(baixados.total).toBe(1);
    });

    it('a disponibilidade é relativa ao instante consultado', async () => {
      const maquina = await novoAtivo();
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(10),
        endsAt: daquiA(20),
      });

      const hoje = await pesquisar.execute({
        tenantId: empresaA.tenantId,
        availability: 'available',
        limit: 20,
        offset: 0,
      });
      const noDia15 = await pesquisar.execute({
        tenantId: empresaA.tenantId,
        availability: 'available',
        em: daquiA(15),
        limit: 20,
        offset: 0,
      });

      // Mesma linha no banco, respostas diferentes: nenhuma rotina precisou
      // rodar para o equipamento "ficar" ocupado no dia 15.
      expect(hoje.total).toBe(1);
      expect(noDia15.total).toBe(0);
    });
  });

  describe('superfície pública (o que Operações vai consumir)', () => {
    it('devolve null para ativo de outra empresa, sem lançar', async () => {
      const maquina = await novoAtivo();
      expect(
        await superficiePublica.findAsset(empresaB.tenantId, maquina.id),
      ).toBeNull();
      expect(
        await superficiePublica.checkAvailability(
          empresaB.tenantId,
          maquina.id,
          daquiA(1),
          daquiA(2),
        ),
      ).toBeNull();
    });

    it('diz até quando o equipamento está comprometido', async () => {
      const maquina = await novoAtivo();
      const ate = daquiA(20);
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(10),
        endsAt: ate,
      });

      const resposta = await superficiePublica.checkAvailability(
        empresaA.tenantId,
        maquina.id,
        daquiA(12),
        daquiA(14),
      );

      expect(resposta?.available).toBe(false);
      expect(resposta?.heldUntil?.getTime()).toBe(ate.getTime());
    });
  });

  describe('isolamento entre empresas', () => {
    it('o ativo de A não aparece na pesquisa de B', async () => {
      await novoAtivo();
      const daOutra = await pesquisar.execute({
        tenantId: empresaB.tenantId,
        limit: 20,
        offset: 0,
      });
      expect(daOutra.total).toBe(0);
    });

    it('nem com o id em mãos', async () => {
      const maquina = await novoAtivo();
      expect(await ativos.findById(empresaB.tenantId, maquina.id)).toBeNull();
    });

    it('a RLS barra a leitura mesmo em consulta sem filtro de tenant', async () => {
      // De propósito sem `where tenant_id`: é o que sobra quando o código erra.
      const maquina = await novoAtivo();
      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: maquina.id,
        reason: 'reserved',
        startsAt: daquiA(1),
        endsAt: daquiA(2),
      });

      const [ativosVistos, bloqueiosVistos] = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        async (tx) => [
          await tx.select().from(assets),
          await tx.select().from(assetHolds),
        ],
      );

      expect(ativosVistos).toHaveLength(0);
      expect(bloqueiosVistos).toHaveLength(0);
    });

    it('a RLS barra a ESCRITA de linha de outra empresa', async () => {
      const erro = await inserirAtivoDireto(empresaB.tenantId, {
        id: randomUUID(),
        tenantId: empresaA.tenantId,
        code: 'INVASOR-1',
      }).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_RLS);
    });

    it('o bloqueio de A não colide com o de B sobre ids diferentes', async () => {
      // A restrição de exclusão inclui `tenant_id`: empresas não disputam
      // janela entre si nem por acidente.
      const daA = await novoAtivo('ESC-014', empresaA.tenantId);
      const daB = await novoAtivo('ESC-014', empresaB.tenantId);
      const janela = { startsAt: daquiA(10), endsAt: daquiA(20) };

      await bloquear.execute({
        tenantId: empresaA.tenantId,
        assetId: daA.id,
        reason: 'reserved',
        ...janela,
      });
      const outro = await bloquear.execute({
        tenantId: empresaB.tenantId,
        assetId: daB.id,
        reason: 'reserved',
        ...janela,
      });

      expect(outro.assetId).toBe(daB.id);
    });
  });

  /** Escrita direta, sem passar pelo caso de uso: exercita o banco. */
  function inserirAtivoDireto(
    escopo: string,
    linha: { id: string; tenantId: string; code: string },
  ): Promise<unknown> {
    const agora = new Date();
    return withTenant(handle.db, { tenantId: toTenantId(escopo) }, (tx) =>
      tx
        .insert(assets)
        .values({
          id: linha.id,
          tenantId: linha.tenantId,
          code: linha.code,
          name: 'direto no banco',
          category: 'teste',
          serialNumber: null,
          acquiredOn: null,
          status: 'active',
          notes: null,
          createdAt: agora,
          updatedAt: agora,
          retiredAt: null,
          retireReason: null,
        })
        .then(() => null),
    );
  }

  function inserirBloqueioDireto(
    escopo: string,
    linha: { assetId: string; startsAt: Date; endsAt: Date },
  ): Promise<unknown> {
    return withTenant(handle.db, { tenantId: toTenantId(escopo) }, (tx) =>
      tx
        .insert(assetHolds)
        .values({
          id: randomUUID(),
          tenantId: escopo,
          assetId: linha.assetId,
          reason: 'reserved',
          startsAt: linha.startsAt,
          endsAt: linha.endsAt,
          releasedAt: null,
          notes: null,
          createdAt: new Date(),
        })
        .then(() => null),
    );
  }
});
