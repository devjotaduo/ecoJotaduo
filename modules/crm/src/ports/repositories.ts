import type {
  Appointment,
  AppointmentStatus,
  Periodo,
} from '../domain/appointment';
import type { Customer } from '../domain/customer';
import type { CustomerNote } from '../domain/note';

export interface Pagina {
  readonly limit: number;
  readonly offset: number;
}

export interface Paginado<T> {
  readonly items: T[];
  readonly total: number;
}

export interface CustomerRepository {
  /** Insere ou atualiza (o agregado decide o que mudou). */
  save(tenantId: string, customer: Customer): Promise<void>;
  findById(tenantId: string, customerId: string): Promise<Customer | null>;
  /** `documento` já normalizado (só dígitos) — usado para garantir unicidade. */
  findByDocument(tenantId: string, documento: string): Promise<Customer | null>;
  search(
    tenantId: string,
    filtro: { termo?: string; apenasAtivos?: boolean } & Pagina,
  ): Promise<Paginado<Customer>>;
}

export interface CustomerNoteRepository {
  add(tenantId: string, note: CustomerNote): Promise<void>;
  listByCustomer(
    tenantId: string,
    customerId: string,
    pagina: Pagina,
  ): Promise<Paginado<CustomerNote>>;
}

export interface AppointmentRepository {
  save(tenantId: string, appointment: Appointment): Promise<void>;
  findById(
    tenantId: string,
    appointmentId: string,
  ): Promise<Appointment | null>;
  /**
   * Candidatos a conflito: agendamentos abertos do mesmo responsável cuja
   * janela toca o período informado. Quem decide se conflita é o domínio.
   */
  findOpenForAssignee(
    tenantId: string,
    assignedToId: string,
    periodo: Periodo,
  ): Promise<Appointment[]>;
  listByCustomer(
    tenantId: string,
    customerId: string,
    pagina: Pagina,
  ): Promise<Paginado<Appointment>>;
  listByPeriod(
    tenantId: string,
    periodo: Periodo,
    filtro: { assignedToId?: string; status?: AppointmentStatus } & Pagina,
  ): Promise<Paginado<Appointment>>;
}
