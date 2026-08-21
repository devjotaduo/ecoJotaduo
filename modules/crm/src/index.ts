export * from './manifest';
export * from './crm.tokens';
export * from './contracts/public-api';
export { CrmService } from './crm.service';

// Domínio
export {
  Appointment,
  type AppointmentStatus,
  type Periodo,
} from './domain/appointment';
export { Customer, type CustomerStatus } from './domain/customer';
export { CustomerDocument } from './domain/document';
export { CustomerNote } from './domain/note';
export {
  AppointmentConflictError,
  AppointmentInThePastError,
  AppointmentNotFoundError,
  AppointmentNotOpenError,
  CustomerArchivedError,
  CustomerNotFoundError,
  DuplicateCustomerDocumentError,
  EmptyNoteError,
  InvalidAppointmentDurationError,
  InvalidAppointmentTitleError,
  InvalidCustomerNameError,
  InvalidDocumentError,
} from './domain/errors';

// Aplicação
export {
  CreateCustomerUseCase,
  GetCustomerUseCase,
  SearchCustomersUseCase,
  UpdateCustomerUseCase,
  type ClienteComHistorico,
  type ItemDoHistorico,
} from './application/customers.use-cases';
export {
  AddCustomerNoteUseCase,
  ListCustomerNotesUseCase,
} from './application/notes.use-cases';
export {
  CloseAppointmentUseCase,
  ListAgendaUseCase,
  ScheduleAppointmentUseCase,
} from './application/appointments.use-cases';

// Portas
export type {
  AppointmentRepository,
  CustomerNoteRepository,
  CustomerRepository,
  Pagina,
  Paginado,
} from './ports/repositories';

// Adaptadores
export {
  DrizzleAppointmentRepository,
  DrizzleCustomerNoteRepository,
  DrizzleCustomerRepository,
} from './adapters/persistence/repositories';
export {
  appointments,
  customerNotes,
  customers,
} from './adapters/persistence/schema';
export {
  crmMcpContribution,
  crmMcpTools,
  type CrmUseCases,
} from './adapters/mcp/contribution';
export {
  agendamentoJson,
  clienteJson,
  historicoJson,
  notaJson,
} from './adapters/http/presenters';
