export * from './manifest';
export * from './plugins.tokens';
export { PluginCatalog } from './catalog';

// Domínio
export {
  assertPermissoesPedidas,
  PluginInstallation,
  type DadosDaInstalacao,
} from './domain/installation';
export {
  ConfiguracaoInvalidaError,
  PermissaoNaoPedidaError,
  PluginDesabilitadoError,
  PluginDesconhecidoError,
  PluginJaInstaladoError,
  PluginNaoInstaladoError,
  SegredoNaoPedidoError,
  TransicaoDePluginInvalidaError,
} from './domain/errors';

// Aplicação
export {
  ChangePluginStatusUseCase,
  ConfigurePluginUseCase,
  InstallPluginUseCase,
  ListPluginsUseCase,
  type PluginNoCatalogo,
} from './application/manage-plugins.use-cases';
export {
  ListEnabledPluginsUseCase,
  ResolvePluginRuntimeUseCase,
} from './application/plugin-runtime.use-case';

// Portas
export type {
  DonoDeSegredo,
  PluginInstallationRepository,
  PluginSecretRepository,
  SecretSealer,
} from './ports/repositories';

// Adaptadores
export { CofreDeSegredosDoPlugin } from './adapters/crypto/secret-sealer';
export {
  DrizzlePluginInstallationRepository,
  DrizzlePluginSecretRepository,
} from './adapters/persistence/repositories';
export {
  pluginInstallations,
  pluginSecrets,
} from './adapters/persistence/schema';
export { PluginsController } from './adapters/http/plugins.controller';
