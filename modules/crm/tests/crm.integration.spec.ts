import { NoopAuditLogger } from '@ecojotaduo/audit';
import {
  createDatabase,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@ecojotaduo/database';
import {
  conexaoDoDono,
  exigirBancoEmCI,
  limparDados,
  migracoesDaPlataforma,
  reservarBancoDeTestes,
  semearTenant,
  temBancoDeTeste,
  urlDaAplicacao,
  type TenantSemeado,
} from '@ecojotaduo/test-support';
import { toTenantId } from '@ecojotaduo/tenant-context';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ScheduleAppointmentUseCase } from '../src/application/appointments.use-cases';
import {
  CreateCustomerUseCase,
  GetCustomerUseCase,
} from '../src/application/customers.use-cases';
import { AddCustomerNoteUseCase } from '../src/application/notes.use-cases';
import { AppointmentConflictError } from '../src/domain/errors';
import {
  DrizzleAppointmentRepository,
  DrizzleCustomerNoteRepository,
  DrizzleCustomerRepository,
} from '../src/adapters/persistence/repositories';
import { customers } from '../src/adapters/persistence/schema';

// Sem banco no CI, falha em vez de passar pulado.
exigirBancoEmCI();

const CNPJ = '11.222.333/0001-81';
const AMANHA = new Date(Date.now() + 24 * 60 * 60 * 1000);

/** Comportamentos que só aparecem contra o PostgreSQL de verdade. */
describe.skipIf(!temBancoDeTeste)('CRM (integração)', () => {
  let dono: postgres.Sql;
  let liberarBanco: (() => Promise<void>) | undefined;
  let handle: DatabaseHandle;
  let empresaA: TenantSemeado;
  let empresaB: TenantSemeado;

  let clientes: DrizzleCustomerRepository;
  let notas: DrizzleCustomerNoteRepository;
  let agendamentos: DrizzleAppointmentRepository;
  let audit: NoopAuditLogger;

  beforeAll(async () => {
    liberarBanco = await reservarBancoDeTestes();
    dono = conexaoDoDono();
    await runMigrations(dono, migracoesDaPlataforma());
    handle = createDatabase({ url: urlDaAplicacao(), quiet: true });
    clientes = new DrizzleCustomerRepository(handle.db);
    notas = new DrizzleCustomerNoteRepository(handle.db);
    agendamentos = new DrizzleAppointmentRepository(handle.db);
  });

  afterAll(async () => {
    await handle.close();
    await dono.end({ timeout: 5 });
    await liberarBanco?.();
  });

  beforeEach(async () => {
    await dono`truncate table crm_appointments, crm_customer_notes, crm_customers cascade`;
    await limparDados(dono);
    audit = new NoopAuditLogger();
    empresaA = await semearTenant(dono, {
      slug: 'empresa-a',
      email: 'ana@empresa-a.com.br',
      modulos: ['crm'],
    });
    empresaB = await semearTenant(dono, {
      slug: 'empresa-b',
      email: 'bruno@empresa-b.com.br',
      modulos: ['crm'],
    });
  });

  function criarCliente(tenantId: string) {
    return new CreateCustomerUseCase(clientes, audit).execute({
      tenantId,
      name: 'Construtora Alfa',
      document: CNPJ,
      email: 'contato@alfa.com.br',
    });
  }

  describe('cadastro de cliente', () => {
    it('persiste o documento só com dígitos e devolve formatado', async () => {
      const criado = await criarCliente(empresaA.tenantId);
      const lido = await clientes.findById(empresaA.tenantId, criado.id);

      expect(lido?.document?.digits).toBe('11222333000181');
      expect(lido?.document?.format()).toBe(CNPJ);
      expect(lido?.email).toBe('contato@alfa.com.br');
    });

    it('encontra por documento ignorando a pontuação digitada', async () => {
      await criarCliente(empresaA.tenantId);

      const achado = await clientes.findByDocument(
        empresaA.tenantId,
        '11222333000181',
      );
      expect(achado?.name).toBe('Construtora Alfa');
    });

    it('empresas diferentes podem ter o MESMO cliente cadastrado', async () => {
      await criarCliente(empresaA.tenantId);

      // A unicidade é por tenant: o mesmo CNPJ é cliente de duas empresas.
      await expect(criarCliente(empresaB.tenantId)).resolves.toBeDefined();
    });

    it('pesquisa por nome, e-mail e documento', async () => {
      await criarCliente(empresaA.tenantId);

      for (const termo of ['alfa', 'contato@', '11222333']) {
        const resultado = await clientes.search(empresaA.tenantId, {
          termo,
          limit: 10,
          offset: 0,
        });
        expect(resultado.total, `termo: ${termo}`).toBe(1);
      }
    });
  });

  describe('notas e linha do tempo', () => {
    it('monta o histórico juntando notas e agendamentos, do mais recente ao mais antigo', async () => {
      const cliente = await criarCliente(empresaA.tenantId);

      await new AddCustomerNoteUseCase(clientes, notas, audit).execute({
        tenantId: empresaA.tenantId,
        customerId: cliente.id,
        body: 'Cliente pediu orçamento de escavadeira',
        authorId: empresaA.userId,
      });
      await new ScheduleAppointmentUseCase(
        clientes,
        agendamentos,
        audit,
      ).execute({
        tenantId: empresaA.tenantId,
        customerId: cliente.id,
        title: 'Visita técnica',
        scheduledFor: AMANHA,
        durationMinutes: 60,
        assignedToId: empresaA.userId,
      });

      const { timeline } = await new GetCustomerUseCase(
        clientes,
        notas,
        agendamentos,
      ).execute({ tenantId: empresaA.tenantId, customerId: cliente.id });

      expect(timeline).toHaveLength(2);
      // O agendamento é amanhã; a nota é agora — logo o agendamento vem antes.
      expect(timeline[0]?.kind).toBe('appointment');
      expect(timeline[1]?.kind).toBe('note');
      expect(timeline[1]?.summary).toContain('escavadeira');
    });
  });

  describe('conflito de agenda (consulta no banco + regra no domínio)', () => {
    async function agendar(
      tenantId: string,
      customerId: string,
      inicio: Date,
      assignedToId: string | null,
    ) {
      return new ScheduleAppointmentUseCase(
        clientes,
        agendamentos,
        audit,
      ).execute({
        tenantId,
        customerId,
        title: 'Reunião',
        scheduledFor: inicio,
        durationMinutes: 60,
        assignedToId,
      });
    }

    it('recusa sobreposição na agenda do mesmo responsável', async () => {
      const cliente = await criarCliente(empresaA.tenantId);
      await agendar(empresaA.tenantId, cliente.id, AMANHA, empresaA.userId);

      const sobreposto = new Date(AMANHA.getTime() + 30 * 60_000);
      await expect(
        agendar(empresaA.tenantId, cliente.id, sobreposto, empresaA.userId),
      ).rejects.toThrow(AppointmentConflictError);
    });

    it('aceita agendamento encostado (termina quando o outro começa)', async () => {
      const cliente = await criarCliente(empresaA.tenantId);
      await agendar(empresaA.tenantId, cliente.id, AMANHA, empresaA.userId);

      const emSeguida = new Date(AMANHA.getTime() + 60 * 60_000);
      await expect(
        agendar(empresaA.tenantId, cliente.id, emSeguida, empresaA.userId),
      ).resolves.toBeDefined();
    });

    it('a agenda de outra empresa não gera conflito', async () => {
      const clienteA = await criarCliente(empresaA.tenantId);
      const clienteB = await criarCliente(empresaB.tenantId);
      await agendar(empresaA.tenantId, clienteA.id, AMANHA, empresaA.userId);

      // Mesmo horário, mesma pessoa como responsável, empresa diferente:
      // a consulta de conflito roda dentro do escopo do tenant.
      await expect(
        agendar(empresaB.tenantId, clienteB.id, AMANHA, empresaA.userId),
      ).resolves.toBeDefined();
    });
  });

  describe('isolamento entre empresas', () => {
    it('cliente da empresa A é invisível para a empresa B', async () => {
      const criado = await criarCliente(empresaA.tenantId);

      expect(await clientes.findById(empresaB.tenantId, criado.id)).toBeNull();
      const busca = await clientes.search(empresaB.tenantId, {
        termo: 'Alfa',
        limit: 10,
        offset: 0,
      });
      expect(busca.total).toBe(0);
    });

    it('RLS barra a leitura mesmo em consulta sem filtro de tenant', async () => {
      await criarCliente(empresaA.tenantId);
      await criarCliente(empresaB.tenantId);

      const vistosPelaB = await withTenant(
        handle.db,
        { tenantId: toTenantId(empresaB.tenantId) },
        (tx) => tx.select().from(customers),
      );

      expect(vistosPelaB).toHaveLength(1);
      expect(vistosPelaB[0]?.tenantId).toBe(empresaB.tenantId);
    });
  });
});
