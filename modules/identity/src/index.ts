export * from './contracts/public-api';
export * from './manifest';

// Domínio e aplicação: exportados para o composition root montar o módulo.
export { Email } from './domain/email';
export {
  InvalidCredentialsError,
  InvalidEmailError,
  UserNotActiveError,
} from './domain/errors';
export { User, type UserStatus } from './domain/user';
export { VerifyCredentialsUseCase } from './application/verify-credentials.use-case';
export { VerifyServiceAccountUseCase } from './application/verify-service-account.use-case';
export {
  RefreshTokenUseCase,
  RefreshTokenInvalidError,
} from './application/refresh-token.use-case';
export type {
  PasswordHasher,
  RefreshTokenRepository,
  SecretHasher,
  ServiceAccountRepository,
  UserRepository,
} from './ports/repositories';
export {
  DrizzleRefreshTokenRepository,
  DrizzleServiceAccountRepository,
  DrizzleUserRepository,
} from './adapters/persistence/repositories';
export {
  refreshTokens,
  serviceAccounts,
  users,
} from './adapters/persistence/schema';
export { IdentityService } from './identity.service';

// Tokens pessoais: credencial de longa duração de uma PESSOA numa empresa.
export {
  PersonalAccessTokenUseCase,
  PersonalTokenInvalidError,
  PersonalTokenNotFoundError,
  PREFIXO_DE_TOKEN_PESSOAL,
  ehTokenPessoal,
  type GeradorDeToken,
  type PortadorDoTokenPessoal,
  type TokenPessoalEmitido,
  type TokenPessoalResumo,
} from './application/personal-access-token.use-case';
export { DrizzlePersonalAccessTokenRepository } from './adapters/persistence/repositories';
export { personalAccessTokens } from './adapters/persistence/schema';
export type {
  PersonalAccessTokenRecord,
  PersonalAccessTokenRepository,
} from './ports/repositories';
