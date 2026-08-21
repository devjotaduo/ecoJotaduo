export * from './manifest';
export * from './assets.tokens';
export * from './contracts/public-api';

// Domínio
export {
  Asset,
  disponibilidade,
  type AssetAvailability,
  type AssetStatus,
  type DadosDoAtivo,
} from './domain/asset';
export {
  AssetHold,
  MOTIVOS_DE_BLOQUEIO,
  type DadosDoBloqueio,
  type HoldReason,
} from './domain/hold';
export { Periodo } from './domain/periodo';
export {
  AssetHeldError,
  AssetInUseError,
  AssetNotFoundError,
  AssetRetiredError,
  DuplicateAssetCodeError,
  HoldAlreadyReleasedError,
  HoldNotFoundError,
  InvalidAssetPeriodError,
} from './domain/errors';

// Aplicação
export {
  CheckAvailabilityUseCase,
  GetAssetUseCase,
  HoldAssetUseCase,
  RegisterAssetUseCase,
  ReleaseHoldUseCase,
  RetireAssetUseCase,
  SearchAssetsUseCase,
  UpdateAssetUseCase,
  type AtivoComSituacao,
  type Disponibilidade,
} from './application/assets.use-cases';

// Portas
export type {
  AssetHoldRepository,
  AssetRepository,
  FiltroDeAtivos,
  Pagina,
  Paginado,
} from './ports/repositories';

// Adaptadores
export {
  DrizzleAssetHoldRepository,
  DrizzleAssetRepository,
} from './adapters/persistence/repositories';
export { assetHolds, assets } from './adapters/persistence/schema';
export { AssetsController } from './adapters/http/assets.controller';
export { AssetHoldsController } from './adapters/http/asset-holds.controller';
export { ativoJson, bloqueioJson } from './adapters/http/presenters';
export {
  assetsMcpContribution,
  type AssetsUseCases,
} from './adapters/mcp/contribution';
export { patioApp, PATIO_APP_URI } from './adapters/mcp/patio.app';
export { AssetsService } from './assets.service';
