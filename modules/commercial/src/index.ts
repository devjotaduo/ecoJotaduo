export * from './manifest';
export * from './commercial.tokens';
export * from './contracts/public-api';
export { CommercialService } from './commercial.service';

// Domínio
export { Money } from './domain/money';
export {
  Proposal,
  ProposalItem,
  type DadosDaProposta,
  type DadosDoItem,
  type ProposalStatus,
  type ProposalView,
} from './domain/proposal';
export {
  CustomerNotInThisTenantError,
  DiscountExceedsSubtotalError,
  EmptyProposalError,
  InvalidMoneyError,
  InvalidProposalItemError,
  InvalidValidityError,
  MixedCurrencyError,
  ProposalExpiredError,
  ProposalNotDecidableError,
  ProposalNotEditableError,
  ProposalNotFoundError,
} from './domain/errors';

// Aplicação
export {
  CreateProposalUseCase,
  DecideProposalUseCase,
  GetProposalUseCase,
  SearchProposalsUseCase,
  SendProposalUseCase,
  UpdateProposalUseCase,
  type ItemInformado,
  type PropostaComCliente,
} from './application/proposals.use-cases';

// Portas
export type { CustomerDirectory } from './ports/customers';
export type {
  FiltroDePropostas,
  Pagina,
  Paginado,
  ProposalRepository,
} from './ports/repositories';

// Adaptadores
export { DrizzleProposalRepository } from './adapters/persistence/repositories';
export {
  proposalItems,
  proposalNumbers,
  proposals,
} from './adapters/persistence/schema';
export { propostaJson } from './adapters/http/presenters';
export {
  commercialMcpContribution,
  type CommercialUseCases,
} from './adapters/mcp/contribution';
