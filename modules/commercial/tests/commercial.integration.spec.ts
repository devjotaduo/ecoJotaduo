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
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CreateProposalUseCase,
  CustomerNotInThisTenantError,
  DecideProposalUseCase,
  DrizzleProposalRepository,
  SearchProposalsUseCase,
  SendProposalUseCase,
  UpdateProposalUseCase,
  type CustomerDirectory,
} from '../src/index';
import { proposals } from '../src/adapters/persistence/schema';

exigirBancoEmCI();

const CLIENTE_A = '11111111-1111-4111-8111-111111111111';
const CLIENTE_B = '22222222-2222-4222-8222-222222222222';
const DAQUI_A_UMA_SEMANA = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

/** Comportamentos que só aparecem contra o PostgreSQL de verdade. */
describe.skipIf(!temBancoDeTeste)('Comercial (integração)', () => {
  let dono: postgres.Sql;
  let encerrarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  let propostas: DrizzleProposalRepository;
  let criar: CreateProposalUseCase;
  let atualizar: UpdateProposalUseCase;
  let enviar: SendProposalUseCase;
  let decidir: DecideProposalUseCase;
  let pesquisar: SearchProposalsUseCase;

  /**
   * Diretório de clientes falso: cada empresa enxerga só o cliente dela.
   * O Comercial não conhece as tabelas do CRM — fala com esta porta.
   */
  const clientes: CustomerDirectory = {
    findName: (tenantId, customerId) => {
      const donoDoCliente: Record<string, string> = {
        [CLIENTE_A]: empresaA.tenantId,
        [CLIENTE_B]: empresaB.tenantId,
      };
      return Promise.resolve(
        donoDoCliente[customerId] === tenantId ? 'Construtora Alfa' : null,
      );
    },
  };

  beforeAll(async () => {
    encerrarBanco = await prepararBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });

    const audit = new NoopAuditLogger();
    propostas = new DrizzleProposalRepository(handle.db);
    criar = new CreateProposalUseCase(propostas, clientes, audit);
    atualizar = new UpdateProposalUseCase(propostas, audit);
    enviar = new SendProposalUseCase(propostas, audit);
    decidir = new DecideProposalUseCase(propostas, audit);
    pesquisar = new SearchProposalsUseCase(propostas);
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
      modulos: ['crm', 'commercial'],
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm', 'commercial'],
    });
  });

  function novaProposta(tenant: TenantSemeado, customerId = CLIENTE_A) {
    return criar.execute({
      tenantId: tenant.tenantId,
      customerId,
      title: 'Locação de equipamentos',
      currency: 'BRL',
      validUntil: DAQUI_A_UMA_SEMANA(),
      items: [
        {
          description: 'Escavadeira 20t — diária',
          quantity: 3,
          unitPriceCents: 150_000,
        },
      ],
    });
  }

  describe('numeração', () => {
    it('numera a partir de 1 e sem repetir', async () => {
      const primeira = await novaProposta(empresaA);
      const segunda = await novaProposta(empresaA);

      expect(primeira.number).toBe(1);
      expect(segunda.number).toBe(2);
    });

    it('cada empresa tem a própria sequência', async () => {
      await novaProposta(empresaA);
      const daOutra = await novaProposta(empresaB, CLIENTE_B);

      // Duas empresas podem ter a proposta nº 1; é número de documento, não id.
      expect(daOutra.number).toBe(1);
    });

    it('criações SIMULTÂNEAS não disputam o mesmo número', async () => {
      // Com `max(number) + 1` as duas leriam o mesmo máximo e uma violaria a
      // restrição de unicidade. O incremento atômico faz a segunda esperar.
      const criadas = await Promise.all([
        novaProposta(empresaA),
        novaProposta(empresaA),
        novaProposta(empresaA),
        novaProposta(empresaA),
        novaProposta(empresaA),
      ]);

      const numeros = criadas.map((proposta) => proposta.number).sort();
      expect(numeros).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('persistência do agregado', () => {
    it('grava cabeçalho e itens, e relê com o total correto', async () => {
      const criada = await novaProposta(empresaA);
      const relida = await propostas.findById(empresaA.tenantId, criada.id);

      expect(relida?.items).toHaveLength(1);
      expect(relida?.total.cents).toBe(450_000);
      expect(relida?.total.currency).toBe('BRL');
    });

    it('substituir itens não deixa órfãos da versão anterior', async () => {
      const criada = await novaProposta(empresaA);
      await atualizar.execute({
        tenantId: empresaA.tenantId,
        proposalId: criada.id,
        items: [
          {
            description: 'Retroescavadeira — diária',
            quantity: 1,
            unitPriceCents: 90_000,
          },
        ],
      });

      const relida = await propostas.findById(empresaA.tenantId, criada.id);
      expect(relida?.items).toHaveLength(1);
      expect(relida?.total.cents).toBe(90_000);

      const linhas =
        await dono`select count(*)::int as total from commercial_proposal_items`;
      expect(linhas[0]?.total).toBe(1);
    });

    it('o fluxo completo sobrevive ao banco: rascunho → enviada → aceita', async () => {
      const criada = await novaProposta(empresaA);
      await enviar.execute({
        tenantId: empresaA.tenantId,
        proposalId: criada.id,
      });
      const aceita = await decidir.accept({
        tenantId: empresaA.tenantId,
        proposalId: criada.id,
      });

      expect(aceita.status).toBe('accepted');
      expect(aceita.sentAt).not.toBeNull();
      expect(aceita.decidedAt).not.toBeNull();
    });
  });

  describe('referência ao CRM', () => {
    it('recusa proposta para cliente inexistente na empresa', async () => {
      await expect(
        criar.execute({
          tenantId: empresaA.tenantId,
          customerId: CLIENTE_B,
          title: 'Proposta indevida',
          currency: 'BRL',
          validUntil: DAQUI_A_UMA_SEMANA(),
        }),
      ).rejects.toThrow(CustomerNotInThisTenantError);
    });
  });

  describe('isolamento entre empresas', () => {
    it('a proposta de A não aparece na pesquisa de B', async () => {
      await novaProposta(empresaA);

      const daOutra = await pesquisar.execute({
        tenantId: empresaB.tenantId,
        limit: 20,
        offset: 0,
      });
      expect(daOutra.total).toBe(0);
    });

    it('nem com o id em mãos', async () => {
      const criada = await novaProposta(empresaA);
      expect(await propostas.findById(empresaB.tenantId, criada.id)).toBeNull();
    });

    it('a RLS barra a leitura mesmo em consulta sem filtro de tenant', async () => {
      // De propósito sem `where tenant_id`: é o que sobra quando o código erra.
      await novaProposta(empresaA);

      const doPontoDeVistaDeB = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) => tx.select().from(proposals),
      );
      expect(doPontoDeVistaDeB).toHaveLength(0);
    });

    it('a RLS barra a ESCRITA de linha de outra empresa', async () => {
      const erro = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) =>
          tx
            .insert(proposals)
            .values({
              id: '66666666-6666-4666-8666-666666666666',
              tenantId: empresaA.tenantId,
              customerId: CLIENTE_A,
              number: 999,
              status: 'draft',
              currency: 'BRL',
              title: 'invasora',
              notes: null,
              validUntil: DAQUI_A_UMA_SEMANA(),
              createdAt: new Date(),
              updatedAt: new Date(),
              sentAt: null,
              decidedAt: null,
            })
            .then(() => null),
      ).catch((falha: unknown) => falha);

      expect(codigoPostgres(erro)).toBe(SQLSTATE_RLS);
    });
  });
});
