export * from './manifest';
export * from './operations.tokens';

// Domínio
export {
  Rental,
  type DadosDaLocacao,
  type RentalStatus,
  type RentalView,
} from './domain/rental';
export {
  AssetNotInThisTenantError,
  ContractNotActiveError,
  ContractNotInThisTenantError,
  InvalidRentalPeriodError,
  RentalAlreadyStartedError,
  RentalNotActiveError,
  RentalNotFoundError,
  RentalNotScheduledError,
  RentalOutsideContractTermError,
} from './domain/errors';

// Aplicação
export {
  CancelRentalUseCase,
  FinishRentalUseCase,
  GetRentalUseCase,
  ScheduleRentalUseCase,
  SearchRentalsUseCase,
  StartRentalUseCase,
} from './application/rentals.use-cases';

// Portas
export type {
  AssetDirectory,
  EquipamentoLocavel,
  ReservaDeEquipamento,
} from './ports/assets';
export type { ContractDirectory, ContratoDeLocacao } from './ports/contracts';
export type {
  FiltroDeLocacoes,
  Pagina,
  Paginado,
  RentalRepository,
} from './ports/repositories';

// Adaptadores
export { DrizzleRentalRepository } from './adapters/persistence/repositories';
export { rentalNumbers, rentals } from './adapters/persistence/schema';
export { locacaoJson } from './adapters/http/presenters';
export {
  operationsMcpContribution,
  type OperationsUseCases,
} from './adapters/mcp/contribution';
