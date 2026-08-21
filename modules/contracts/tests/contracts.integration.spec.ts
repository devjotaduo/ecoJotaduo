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
  reservarBancoDeTestes,
  semearTenant,
  SQLSTATE_RLS,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import { toTenantId } from '@ecojotaduo/tenant-context';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ActivateContractUseCase,
  CloseContractUseCase,
  CreateContractUseCase,
  DrizzleContractRepository,
  ProposalAlreadyContractedError,
  ProposalNotAcceptedError,
  ProposalNotInThisTenantError,
  SearchContractsUseCase,
  type ProposalDirectory,
  type PropostaAceitavel,
} from '../src/index';
import { contracts } from '../src/adapters/persistence/schema';

exigirBancoEmCI();

const PROPOSTA_ACEITA = '11111111-1111-4111-8111-111111111111';
const PROPOSTA_ENVIADA = '22222222-2222-4222-8222-222222222222';
const PROPOSTA_VENCIDA = '33333333-3333-4333-8333-333333333333';
const CLIENTE = '44444444-4444-4444-8444-444444444444';

const daquiA = (dias: number) =>
  new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

/** Comportamentos que só aparecem contra o PostgreSQL de verdade. */
describe.skipIf(!temBancoDeTeste)('Contratos (integração)', () => {
  let dono: postgres.Sql;
  let liberarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  let contratos: DrizzleContractRepository;
  let formalizar: CreateContractUseCase;
  let ativar: ActivateContractUseCase;
  let encerrar: CloseContractUseCase;
  let pesquisar: SearchContractsUseCase;

  /**
   * Diretório de propostas falso: só a empresa A tem propostas, e cada uma em
   * uma situação. Contratos não conhece as tabelas do Comercial — fala com
   * esta porta.
   */
  const propostas: ProposalDirectory = {
    find: (tenantId, proposalId) => {
      if (tenantId !== empresaA.tenantId) {
        return Promise.resolve(null);
      }
      const catalogo: Record<string, PropostaAceitavel> = {
        [PROPOSTA_ACEITA]: base(PROPOSTA_ACEITA, 1, 'accepted'),
        [PROPOSTA_ENVIADA]: base(PROPOSTA_ENVIADA, 2, 'sent'),
        [PROPOSTA_VENCIDA]: base(PROPOSTA_VENCIDA, 3, 'expired'),
      };
      return Promise.resolve(catalogo[proposalId] ?? null);
    },
  };

  function base(id: string, numero: number, status: string): PropostaAceitavel {
    return {
      proposalId: id,
      number: numero,
      customerId: CLIENTE,
      title: 'Locação de equipamentos',
      currency: 'BRL',
      totalCents: 450_000,
      status,
    };
  }

  beforeAll(async () => {
    liberarBanco = await reservarBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });

    const audit = new NoopAuditLogger();
    contratos = new DrizzleContractRepository(handle.db);
    formalizar = new CreateContractUseCase(contratos, propostas, audit);
    ativar = new ActivateContractUseCase(contratos, audit);
    encerrar = new CloseContractUseCase(contratos, audit);
    pesquisar = new SearchContractsUseCase(contratos);
  });

  afterAll(async () => {
    await handle?.close();
    await dono.end({ timeout: 5 });
    await liberarBanco?.();
  });

  beforeEach(async () => {
    await limparDados(dono);
    empresaA = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['commercial', 'contracts'],
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['commercial', 'contracts'],
    });
  });

  function novoContrato(proposalId = PROPOSTA_ACEITA) {
    return formalizar.execute({
      tenantId: empresaA.tenantId,
      proposalId,
      startsOn: daquiA(1),
      endsOn: daquiA(90),
    });
  }

  describe('nasce de proposta aceita', () => {
    it('copia cliente, título e valor da proposta', async () => {
      const contrato = await novoContrato();

      expect(contrato.customerId).toBe(CLIENTE);
      expect(contrato.title).toBe('Locação de equipamentos');
      expect(contrato.valueCents).toBe(450_000);
      expect(contrato.currency).toBe('BRL');
      expect(contrato.status).toBe('draft');
    });

    it('recusa proposta apenas enviada', async () => {
      await expect(novoContrato(PROPOSTA_ENVIADA)).rejects.toThrow(
        ProposalNotAcceptedError,
      );
    });

    it('recusa proposta vencida', async () => {
      await expect(novoContrato(PROPOSTA_VENCIDA)).rejects.toThrow(
        ProposalNotAcceptedError,
      );
    });

    it('recusa proposta de outra empresa', async () => {
      await expect(
        formalizar.execute({
          tenantId: empresaB.tenantId,
          proposalId: PROPOSTA_ACEITA,
          startsOn: daquiA(1),
          endsOn: daquiA(90),
        }),
      ).rejects.toThrow(ProposalNotInThisTenantError);
    });

    it('uma proposta vira UM contrato só', async () => {
      const primeiro = await novoContrato();
      await expect(novoContrato()).rejects.toThrow(
        ProposalAlreadyContractedError,
      );
      expect(primeiro.number).toBe(1);
    });

    it('a restrição do banco é a rede de baixo da regra', async () => {
      // Se duas formalizações passassem pela verificação ao mesmo tempo, é
      // aqui que a segunda morre.
      await novoContrato();
      const erro = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaA.tenantId) },
        (tx) =>
          tx
            .insert(contracts)
            .values({
              id: '55555555-5555-4555-8555-555555555555',
              tenantId: empresaA.tenantId,
              customerId: CLIENTE,
              proposalId: PROPOSTA_ACEITA,
              number: 99,
              status: 'draft',
              title: 'duplicado',
              currency: 'BRL',
              valueCents: 1,
              startsOn: daquiA(1),
              endsOn: daquiA(90),
              notes: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              activatedAt: null,
              closedAt: null,
              closeReason: null,
            })
            .then(() => null),
      ).catch((falha: unknown) => falha);

      // 23505 = unique_violation.
      expect(codigoPostgres(erro)).toBe('23505');
    });
  });

  describe('numeração', () => {
    it('numera por empresa, sem repetir', async () => {
      const primeiro = await novoContrato(PROPOSTA_ACEITA);
      const segundo = await formalizar
        .execute({
          tenantId: empresaA.tenantId,
          proposalId: PROPOSTA_ENVIADA,
          startsOn: daquiA(1),
          endsOn: daquiA(90),
        })
        .catch(() => null);

      expect(primeiro.number).toBe(1);
      // A segunda proposta não é aceita, então nem chega a numerar.
      expect(segundo).toBeNull();
    });
  });

  describe('ciclo persistido', () => {
    it('rascunho → ativo → encerrado sobrevive ao banco', async () => {
      const criado = await novoContrato();
      await ativar.execute({
        tenantId: empresaA.tenantId,
        contractId: criado.id,
      });
      const encerrado = await encerrar.finish({
        tenantId: empresaA.tenantId,
        contractId: criado.id,
        reason: 'entrega concluída',
      });

      expect(encerrado.status).toBe('finished');
      expect(encerrado.activatedAt).not.toBeNull();
      expect(encerrado.closeReason).toBe('entrega concluída');

      const relido = await contratos.findById(empresaA.tenantId, criado.id);
      expect(relido?.status).toBe('finished');
    });
  });

  describe('isolamento entre empresas', () => {
    it('o contrato de A não aparece na pesquisa de B', async () => {
      await novoContrato();
      const daOutra = await pesquisar.execute({
        tenantId: empresaB.tenantId,
        limit: 20,
        offset: 0,
      });
      expect(daOutra.total).toBe(0);
    });

    it('nem com o id em mãos', async () => {
      const criado = await novoContrato();
      expect(await contratos.findById(empresaB.tenantId, criado.id)).toBeNull();
    });

    it('a RLS barra a leitura mesmo em consulta sem filtro de tenant', async () => {
      // De propósito sem `where tenant_id`: é o que sobra quando o código erra.
      await novoContrato();
      const doPontoDeVistaDeB = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) => tx.select().from(contracts),
      );
      expect(doPontoDeVistaDeB).toHaveLength(0);
    });

    it('a RLS barra a ESCRITA de linha de outra empresa', async () => {
      const erro = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) =>
          tx
            .insert(contracts)
            .values({
              id: '66666666-6666-4666-8666-666666666666',
              tenantId: empresaA.tenantId,
              customerId: CLIENTE,
              proposalId: PROPOSTA_ACEITA,
              number: 999,
              status: 'draft',
              title: 'invasor',
              currency: 'BRL',
              valueCents: 1,
              startsOn: daquiA(1),
              endsOn: daquiA(90),
              notes: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              activatedAt: null,
              closedAt: null,
              closeReason: null,
            })
            .then(() => null),
      ).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_RLS);
    });
  });
});
