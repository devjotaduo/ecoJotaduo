import type { Database } from '@ecojotaduo/database';
import { withTenant } from '@ecojotaduo/database';
import type { TenantId } from '@ecojotaduo/tenant-context';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  lt,
  or,
  sql,
} from 'drizzle-orm';

import {
  Appointment,
  type AppointmentStatus,
  type Periodo,
} from '../../domain/appointment';
import { Customer, type CustomerStatus } from '../../domain/customer';
import { CustomerDocument } from '../../domain/document';
import { CustomerNote } from '../../domain/note';
import type {
  AppointmentRepository,
  CustomerNoteRepository,
  CustomerRepository,
  Pagina,
  Paginado,
} from '../../ports/repositories';

import { appointments, customerNotes, customers } from './schema';

const escopo = (tenantId: string) => ({ tenantId: tenantId as TenantId });

export class DrizzleCustomerRepository implements CustomerRepository {
  constructor(private readonly db: Database) {}

  async save(tenantId: string, customer: Customer): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .insert(customers)
        .values({
          id: customer.id,
          tenantId,
          name: customer.name,
          document: customer.document?.digits ?? null,
          email: customer.email,
          phone: customer.phone,
          status: customer.status,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        })
        .onConflictDoUpdate({
          target: customers.id,
          set: {
            name: customer.name,
            document: customer.document?.digits ?? null,
            email: customer.email,
            phone: customer.phone,
            status: customer.status,
            updatedAt: customer.updatedAt,
          },
        });
    });
  }

  async findById(
    tenantId: string,
    customerId: string,
  ): Promise<Customer | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(customers)
        .where(
          and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)),
        )
        .limit(1);
      return linha ? paraCliente(linha) : null;
    });
  }

  async findByDocument(
    tenantId: string,
    documento: string,
  ): Promise<Customer | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, tenantId),
            eq(customers.document, documento),
          ),
        )
        .limit(1);
      return linha ? paraCliente(linha) : null;
    });
  }

  async search(
    tenantId: string,
    filtro: { termo?: string; apenasAtivos?: boolean } & Pagina,
  ): Promise<Paginado<Customer>> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const termo = filtro.termo?.trim();
      const condicoes = [eq(customers.tenantId, tenantId)];

      if (filtro.apenasAtivos) {
        condicoes.push(eq(customers.status, 'active'));
      }
      if (termo) {
        // Busca por nome, e-mail ou documento — o operador digita o que tiver
        // à mão. Os dígitos cobrem o caso de colar um CNPJ com pontuação.
        const digitos = termo.replace(/\D/g, '');
        const alternativas = [
          ilike(customers.name, `%${termo}%`),
          ilike(customers.email, `%${termo}%`),
        ];
        if (digitos.length >= 3) {
          alternativas.push(ilike(customers.document, `%${digitos}%`));
        }
        const filtroTexto = or(...alternativas);
        if (filtroTexto) condicoes.push(filtroTexto);
      }

      const onde = and(...condicoes);

      const [linhas, [total]] = await Promise.all([
        tx
          .select()
          .from(customers)
          .where(onde)
          .orderBy(asc(customers.name))
          .limit(filtro.limit)
          .offset(filtro.offset),
        tx.select({ valor: count() }).from(customers).where(onde),
      ]);

      return { items: linhas.map(paraCliente), total: total?.valor ?? 0 };
    });
  }
}

export class DrizzleCustomerNoteRepository implements CustomerNoteRepository {
  constructor(private readonly db: Database) {}

  async add(tenantId: string, note: CustomerNote): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx.insert(customerNotes).values({
        id: note.id,
        tenantId,
        customerId: note.customerId,
        body: note.body,
        authorId: note.authorId,
        createdAt: note.createdAt,
      });
    });
  }

  async listByCustomer(
    tenantId: string,
    customerId: string,
    pagina: Pagina,
  ): Promise<Paginado<CustomerNote>> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const onde = and(
        eq(customerNotes.tenantId, tenantId),
        eq(customerNotes.customerId, customerId),
      );

      const [linhas, [total]] = await Promise.all([
        tx
          .select()
          .from(customerNotes)
          .where(onde)
          .orderBy(desc(customerNotes.createdAt))
          .limit(pagina.limit)
          .offset(pagina.offset),
        tx.select({ valor: count() }).from(customerNotes).where(onde),
      ]);

      return {
        items: linhas.map((linha) => CustomerNote.restore(linha)),
        total: total?.valor ?? 0,
      };
    });
  }
}

export class DrizzleAppointmentRepository implements AppointmentRepository {
  constructor(private readonly db: Database) {}

  async save(tenantId: string, appointment: Appointment): Promise<void> {
    await withTenant(this.db, escopo(tenantId), async (tx) => {
      await tx
        .insert(appointments)
        .values({
          id: appointment.id,
          tenantId,
          customerId: appointment.customerId,
          title: appointment.title,
          scheduledFor: appointment.scheduledFor,
          durationMinutes: appointment.durationMinutes,
          assignedToId: appointment.assignedToId,
          status: appointment.status,
          outcome: appointment.outcome,
          createdAt: appointment.createdAt,
          updatedAt: appointment.updatedAt,
        })
        .onConflictDoUpdate({
          target: appointments.id,
          set: {
            title: appointment.title,
            scheduledFor: appointment.scheduledFor,
            durationMinutes: appointment.durationMinutes,
            assignedToId: appointment.assignedToId,
            status: appointment.status,
            outcome: appointment.outcome,
            updatedAt: appointment.updatedAt,
          },
        });
    });
  }

  async findById(
    tenantId: string,
    appointmentId: string,
  ): Promise<Appointment | null> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const [linha] = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, tenantId),
            eq(appointments.id, appointmentId),
          ),
        )
        .limit(1);
      return linha ? paraAgendamento(linha) : null;
    });
  }

  async findOpenForAssignee(
    tenantId: string,
    assignedToId: string,
    periodo: Periodo,
  ): Promise<Appointment[]> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const linhas = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, tenantId),
            eq(appointments.assignedToId, assignedToId),
            eq(appointments.status, 'scheduled'),
            // Janela que toca o período: começa antes do fim E termina depois
            // do início. O fim é calculado no banco a partir da duração.
            //
            // O parâmetro vai como texto ISO com cast explícito: dentro de um
            // fragmento `sql` cru não há coluna para o Drizzle inferir o tipo,
            // e um Date puro quebra a serialização do driver.
            lt(appointments.scheduledFor, periodo.fim),
            sql`${appointments.scheduledFor} + make_interval(mins => ${appointments.durationMinutes}) > ${periodo.inicio.toISOString()}::timestamptz`,
          ),
        );

      return linhas.map(paraAgendamento);
    });
  }

  async listByCustomer(
    tenantId: string,
    customerId: string,
    pagina: Pagina,
  ): Promise<Paginado<Appointment>> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const onde = and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.customerId, customerId),
      );

      const [linhas, [total]] = await Promise.all([
        tx
          .select()
          .from(appointments)
          .where(onde)
          .orderBy(desc(appointments.scheduledFor))
          .limit(pagina.limit)
          .offset(pagina.offset),
        tx.select({ valor: count() }).from(appointments).where(onde),
      ]);

      return { items: linhas.map(paraAgendamento), total: total?.valor ?? 0 };
    });
  }

  async listByPeriod(
    tenantId: string,
    periodo: Periodo,
    filtro: { assignedToId?: string; status?: AppointmentStatus } & Pagina,
  ): Promise<Paginado<Appointment>> {
    return withTenant(this.db, escopo(tenantId), async (tx) => {
      const condicoes = [
        eq(appointments.tenantId, tenantId),
        gte(appointments.scheduledFor, periodo.inicio),
        lt(appointments.scheduledFor, periodo.fim),
      ];
      if (filtro.assignedToId) {
        condicoes.push(eq(appointments.assignedToId, filtro.assignedToId));
      }
      if (filtro.status) {
        condicoes.push(eq(appointments.status, filtro.status));
      }
      const onde = and(...condicoes);

      const [linhas, [total]] = await Promise.all([
        tx
          .select()
          .from(appointments)
          .where(onde)
          .orderBy(asc(appointments.scheduledFor))
          .limit(filtro.limit)
          .offset(filtro.offset),
        tx.select({ valor: count() }).from(appointments).where(onde),
      ]);

      return { items: linhas.map(paraAgendamento), total: total?.valor ?? 0 };
    });
  }
}

function paraCliente(linha: typeof customers.$inferSelect): Customer {
  return Customer.restore({
    id: linha.id,
    name: linha.name,
    document: linha.document ? CustomerDocument.create(linha.document) : null,
    email: linha.email,
    phone: linha.phone,
    status: linha.status as CustomerStatus,
    createdAt: linha.createdAt,
    updatedAt: linha.updatedAt,
  });
}

function paraAgendamento(linha: typeof appointments.$inferSelect): Appointment {
  return Appointment.restore({
    id: linha.id,
    customerId: linha.customerId,
    title: linha.title,
    scheduledFor: linha.scheduledFor,
    durationMinutes: linha.durationMinutes,
    assignedToId: linha.assignedToId,
    status: linha.status as AppointmentStatus,
    outcome: linha.outcome,
    createdAt: linha.createdAt,
    updatedAt: linha.updatedAt,
  });
}
