export * from './manifest';
export * from './contracts.tokens';
export * from './contracts/public-api';

// Domínio
export {
  Contract,
  type ContractStatus,
  type ContractView,
  type DadosDoContrato,
} from './domain/contract';
export {
  ContractNotActiveError,
  ContractNotDraftError,
  ContractNotFoundError,
  ContractTermEndedError,
  InvalidContractTermError,
  ProposalAlreadyContractedError,
  ProposalNotAcceptedError,
  ProposalNotInThisTenantError,
} from './domain/errors';

// Aplicação
export {
  ActivateContractUseCase,
  CloseContractUseCase,
  CreateContractUseCase,
  GetContractUseCase,
  SearchContractsUseCase,
} from './application/contracts.use-cases';

// Portas
export type { PropostaAceitavel, ProposalDirectory } from './ports/proposals';
export type {
  ContractRepository,
  FiltroDeContratos,
  Pagina,
  Paginado,
} from './ports/repositories';

// Adaptadores
export { DrizzleContractRepository } from './adapters/persistence/repositories';
export { contractNumbers, contracts } from './adapters/persistence/schema';
export { ContractsController } from './adapters/http/contracts.controller';
export { contratoJson } from './adapters/http/presenters';
export {
  contractsMcpContribution,
  type ContractsUseCases,
} from './adapters/mcp/contribution';
export { ContractsService } from './contracts.service';
