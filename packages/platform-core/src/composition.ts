import { randomUUID } from 'node:crypto';

import type { AuditLogger } from '@ecojotaduo/audit';
import { DrizzleAuditLogger } from '@ecojotaduo/audit/drizzle';
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  opaqueTokenMatches,
  TokenService,
  verifyPassword,
} from '@ecojotaduo/auth';
import {
  CheckAvailabilityUseCase,
  DrizzleAssetHoldRepository,
  DrizzleAssetRepository,
  GetAssetUseCase,
  HoldAssetUseCase,
  RegisterAssetUseCase,
  ReleaseHoldUseCase,
  RetireAssetUseCase,
  SearchAssetsUseCase,
  UpdateAssetUseCase,
  assetsMcpContribution,
  AssetsService,
  type AssetsUseCases,
} from '@ecojotaduo/assets';
import type { Env } from '@ecojotaduo/config';
import {
  AddCustomerNoteUseCase,
  CloseAppointmentUseCase,
  CreateCustomerUseCase,
  DrizzleAppointmentRepository,
  DrizzleCustomerNoteRepository,
  DrizzleCustomerRepository,
  GetCustomerUseCase,
  ListAgendaUseCase,
  ListCustomerNotesUseCase,
  ScheduleAppointmentUseCase,
  SearchCustomersUseCase,
  UpdateCustomerUseCase,
  crmMcpContribution,
  CrmService,
  type CrmUseCases,
} from '@ecojotaduo/crm';
import {
  CreateProposalUseCase,
  DecideProposalUseCase,
  DrizzleProposalRepository,
  GetProposalUseCase,
  SearchProposalsUseCase,
  SendProposalUseCase,
  UpdateProposalUseCase,
  commercialMcpContribution,
  CommercialService,
  type CommercialUseCases,
  type CustomerDirectory,
} from '@ecojotaduo/commercial';
import {
  ActivateContractUseCase,
  CloseContractUseCase,
  contractsMcpContribution,
  CreateContractUseCase,
  DrizzleContractRepository,
  GetContractUseCase,
  SearchContractsUseCase,
  ContractsService,
  type ContractsUseCases,
  type ProposalDirectory,
} from '@ecojotaduo/contracts';
import { createDatabase, type DatabaseHandle } from '@ecojotaduo/database';
import { McpCatalog } from '@ecojotaduo/mcp-kit';
import {
  definirPluginDeNotificacoes,
  notificationsMcpContribution,
  SendNotificationUseCase,
  NOTIFICATIONS_PLUGIN_ID,
  type ConfiguracaoDeNotificacoes,
  type LeitorDeClientes,
  type PoliticaDeDestino,
} from '@ecojotaduo/plugin-notifications-example';
import {
  CancelRentalUseCase,
  DrizzleRentalRepository,
  FinishRentalUseCase,
  GetRentalUseCase,
  operationsMcpContribution,
  ScheduleRentalUseCase,
  SearchRentalsUseCase,
  StartRentalUseCase,
  type AssetDirectory,
  type ContractDirectory,
  type OperationsUseCases,
} from '@ecojotaduo/operations';
import type {
  PluginRuntime,
  PluginRuntimeProvider,
} from '@ecojotaduo/plugin-sdk';
import {
  ChangePluginStatusUseCase,
  CofreDeSegredosDoPlugin,
  ConfigurePluginUseCase,
  DrizzlePluginInstallationRepository,
  DrizzlePluginSecretRepository,
  InstallPluginUseCase,
  ListEnabledPluginsUseCase,
  ListPluginsUseCase,
  PluginCatalog,
  ResolvePluginRuntimeUseCase,
} from '@ecojotaduo/plugins';
import { lerChaveDeSegredos } from '@ecojotaduo/auth';
import { pluginEntitlement } from '@ecojotaduo/permissions';
import {
  DrizzleRefreshTokenRepository,
  DrizzleServiceAccountRepository,
  DrizzleUserRepository,
  IdentityService,
  RefreshTokenUseCase,
  VerifyCredentialsUseCase,
  VerifyServiceAccountUseCase,
  type IdentityPublicApi,
  type PasswordHasher,
  type SecretHasher,
} from '@ecojotaduo/identity';
import type { ResolvedModules } from '@ecojotaduo/platform-kernel';
import {
  DrizzleEntitlementRepository,
  DrizzleMembershipRepository,
  DrizzleTenantRepository,
  IssueServiceTokenUseCase,
  ManageEntitlementsUseCase,
  RefreshSessionUseCase,
  ResolveAccessGrantUseCase,
  SignInUseCase,
  TenancyService,
  type AccessTokenIssuer,
  type TenancyPublicApi,
} from '@ecojotaduo/tenancy';

import { catalogoDeModulos } from './modules';

const hasherDeSenha: PasswordHasher = {
  hash: hashPassword,
  verify: verifyPassword,
};
const hasherDeSegredo: SecretHasher = {
  hash: hashOpaqueToken,
  matches: opaqueTokenMatches,
};

export interface NucleoDaPlataforma {
  readonly handle: DatabaseHandle;
  readonly catalogo: ResolvedModules;
  readonly tokens: TokenService;
  readonly audit: AuditLogger;
  readonly identity: IdentityPublicApi;
  readonly tenancy: TenancyPublicApi;
  readonly signIn: SignInUseCase;
  readonly refreshSession: RefreshSessionUseCase;
  readonly serviceToken: IssueServiceTokenUseCase;
  readonly entitlements: ManageEntitlementsUseCase;
  readonly crm: CrmCompleto;
  readonly commercial: CommercialCompleto;
  readonly contracts: ContractsUseCases;
  readonly assets: AssetsUseCases;
  readonly operations: OperationsUseCases;
  /**
   * Catálogo MCP da instalação. Já sabe filtrar por `AccessGrant`; o gateway
   * só o liga ao transporte.
   */
  readonly mcp: McpCatalog;
  readonly plugins: PluginsCompleto;
}

/** Registry de plugins e a borda do plugin de exemplo. */
export interface PluginsCompleto {
  readonly catalogo: PluginCatalog;
  readonly instalar: InstallPluginUseCase;
  readonly configurar: ConfigurePluginUseCase;
  readonly status: ChangePluginStatusUseCase;
  readonly listar: ListPluginsUseCase;
  readonly resolverRuntime: ResolvePluginRuntimeUseCase;
  readonly notificacoes: SendNotificationUseCase;
  readonly runtimeDeNotificacoes: PluginRuntimeProvider<ConfiguracaoDeNotificacoes>;
}

export interface OpcoesDoNucleo {
  /**
   * Política de destino dos webhooks de plugin. O padrão recusa a rede
   * interna; os testes E2E injetam uma que aceita o servidor local, para
   * exercitar a entrega sem sair da máquina.
   */
  readonly politicaDeDestinoDeWebhook?: PoliticaDeDestino;
}

/**
 * Casos de uso do CRM.
 *
 * Estende `CrmUseCases` (o subconjunto que vira tool MCP) com o que hoje só
 * tem borda REST. Passar este objeto para a contribuição MCP funciona por
 * tipagem estrutural — e deixa explícito que não existem duas implementações.
 */
export interface CrmCompleto extends CrmUseCases {
  readonly atualizarCliente: UpdateCustomerUseCase;
  readonly listarNotas: ListCustomerNotesUseCase;
}

/** Idem para o Comercial: mesma instância no REST e no MCP. */
export interface CommercialCompleto extends CommercialUseCases {
  readonly atualizarProposta: UpdateProposalUseCase;
}

/** Adapta o TokenService (criptografia) à porta esperada pelos casos de uso. */
function emissorDeToken(tokens: TokenService): AccessTokenIssuer {
  return {
    issue: (entrada) =>
      tokens.issue({
        sub: entrada.subject,
        tid: entrada.tenantId,
        kind: entrada.kind,
        scope: entrada.scopes,
        jti: randomUUID(),
      }),
  };
}

/**
 * Monta os módulos de domínio uma única vez.
 *
 * Vive num pacote, e não dentro de `apps/api`, porque todo composition root
 * chama esta mesma função: a API REST, o gateway MCP e (na Fase 8) o worker.
 * Nenhuma regra de negócio aqui — só a ligação entre adaptadores concretos e
 * casos de uso. É esta função que garante, na prática, regra de negócio única.
 */
export function criarNucleo(
  env: Env,
  opcoes: OpcoesDoNucleo = {},
): NucleoDaPlataforma {
  const catalogo = catalogoDeModulos();
  const handle = createDatabase({
    url: env.DATABASE_URL,
    quiet: env.NODE_ENV === 'test',
  });
  const { db } = handle;

  const tokens = new TokenService({
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  });
  const emissor = emissorDeToken(tokens);
  const audit = new DrizzleAuditLogger(db);

  // --- identity -----------------------------------------------------------
  const usuarios = new DrizzleUserRepository(db);
  const identity = new IdentityService(
    new VerifyCredentialsUseCase(usuarios, hasherDeSenha),
    new VerifyServiceAccountUseCase(
      new DrizzleServiceAccountRepository(db),
      hasherDeSegredo,
    ),
    new RefreshTokenUseCase(
      new DrizzleRefreshTokenRepository(db),
      hasherDeSegredo,
      { create: createOpaqueToken },
      env.REFRESH_TOKEN_TTL_DAYS,
    ),
    usuarios,
  );

  // --- plugins ------------------------------------------------------------
  // Montado antes do tenancy: um plugin habilitado é entitlement, e a
  // resolução de acesso precisa da fonte pronta.
  const instalacoesRepo = new DrizzlePluginInstallationRepository(db);
  const segredosRepo = new DrizzlePluginSecretRepository(db);
  const plugsHabilitados = new ListEnabledPluginsUseCase(instalacoesRepo);

  // --- tenancy ------------------------------------------------------------
  const tenantsRepo = new DrizzleTenantRepository(db);
  const entitlementsRepo = new DrizzleEntitlementRepository(db);
  const resolverAcesso = new ResolveAccessGrantUseCase(
    tenantsRepo,
    new DrizzleMembershipRepository(db),
    entitlementsRepo,
    [
      {
        listEntitlements: async (tenantId) =>
          (await plugsHabilitados.execute(tenantId)).map(pluginEntitlement),
      },
    ],
  );

  // --- crm ----------------------------------------------------------------
  const clientesRepo = new DrizzleCustomerRepository(db);
  const notasRepo = new DrizzleCustomerNoteRepository(db);
  const agendamentosRepo = new DrizzleAppointmentRepository(db);

  // Uma instância de cada caso de uso, compartilhada por REST e MCP. É esta
  // linha que garante, na prática, que as duas bordas não divirjam.
  const crm: CrmCompleto = {
    criarCliente: new CreateCustomerUseCase(clientesRepo, audit),
    atualizarCliente: new UpdateCustomerUseCase(clientesRepo, audit),
    obterCliente: new GetCustomerUseCase(
      clientesRepo,
      notasRepo,
      agendamentosRepo,
    ),
    pesquisarClientes: new SearchCustomersUseCase(clientesRepo),
    adicionarNota: new AddCustomerNoteUseCase(clientesRepo, notasRepo, audit),
    listarNotas: new ListCustomerNotesUseCase(clientesRepo, notasRepo),
    agendar: new ScheduleAppointmentUseCase(
      clientesRepo,
      agendamentosRepo,
      audit,
    ),
    encerrarAgendamento: new CloseAppointmentUseCase(agendamentosRepo, audit),
    listarAgenda: new ListAgendaUseCase(agendamentosRepo),
  };

  // --- plugins (continuação, agora que o CRM existe) -----------------------
  const definicaoDeNotificacoes = definirPluginDeNotificacoes(
    opcoes.politicaDeDestinoDeWebhook,
  );
  const catalogoDePlugins = new PluginCatalog([definicaoDeNotificacoes], {
    eventosConhecidos: catalogo.ordered.flatMap((manifest) =>
      manifest.events.map((evento) => evento.type),
    ),
  });
  const cofre = new CofreDeSegredosDoPlugin(
    lerChaveDeSegredos(env.SECRETS_KEY),
  );
  const resolverRuntime = new ResolvePluginRuntimeUseCase(
    catalogoDePlugins,
    instalacoesRepo,
    segredosRepo,
    cofre,
  );

  /**
   * O plugin lê o cliente por uma PORTA, não importando o módulo CRM: é assim
   * que ele continuaria funcionando se um dia virasse externo. A permissão
   * `crm.customer.read` é conferida dentro do caso de uso do plugin, contra o
   * que a instalação concedeu.
   */
  const leitorDeClientes: LeitorDeClientes = {
    nomeDoCliente: async (tenantId, customerId) => {
      const { customer } = await crm.obterCliente.execute({
        tenantId,
        customerId,
        historicoLimite: 1,
      });
      return customer.name;
    },
  };

  const runtimeDeNotificacoes: PluginRuntimeProvider<ConfiguracaoDeNotificacoes> =
    {
      // A configuração já foi validada pelo schema do plugin ao ser gravada;
      // aqui só se recupera o tipo que o `PluginRuntime` genérico perdeu.
      carregar: async (entrada) =>
        (await resolverRuntime.execute({
          ...entrada,
          pluginId: NOTIFICATIONS_PLUGIN_ID,
        })) as PluginRuntime<ConfiguracaoDeNotificacoes>,
    };

  const notificacoes = new SendNotificationUseCase(
    leitorDeClientes,
    audit,
    globalThis.fetch,
    opcoes.politicaDeDestinoDeWebhook,
  );

  const plugins: PluginsCompleto = {
    catalogo: catalogoDePlugins,
    instalar: new InstallPluginUseCase(
      catalogoDePlugins,
      instalacoesRepo,
      audit,
    ),
    configurar: new ConfigurePluginUseCase(
      catalogoDePlugins,
      instalacoesRepo,
      segredosRepo,
      cofre,
      audit,
    ),
    status: new ChangePluginStatusUseCase(
      catalogoDePlugins,
      instalacoesRepo,
      segredosRepo,
      audit,
    ),
    listar: new ListPluginsUseCase(
      catalogoDePlugins,
      instalacoesRepo,
      segredosRepo,
      {
        verificar: (tenantId, pluginId) =>
          resolverRuntime.verificarSaude(tenantId, pluginId),
      },
    ),
    resolverRuntime,
    notificacoes,
    runtimeDeNotificacoes,
  };

  // --- comercial ----------------------------------------------------------
  // A proposta é sempre PARA um cliente: a referência é conferida contra a
  // superfície pública do CRM, nunca contra a tabela dele.
  const diretorioDeClientes: CustomerDirectory = {
    findName: async (tenantId, customerId) =>
      (await new CrmService(clientesRepo).findCustomer(tenantId, customerId))
        ?.name ?? null,
  };
  const propostasRepo = new DrizzleProposalRepository(db);
  const commercial: CommercialCompleto = {
    criarProposta: new CreateProposalUseCase(
      propostasRepo,
      diretorioDeClientes,
      audit,
    ),
    atualizarProposta: new UpdateProposalUseCase(propostasRepo, audit),
    obterProposta: new GetProposalUseCase(propostasRepo, diretorioDeClientes),
    pesquisarPropostas: new SearchProposalsUseCase(propostasRepo),
    enviarProposta: new SendProposalUseCase(propostasRepo, audit),
    decidirProposta: new DecideProposalUseCase(propostasRepo, audit),
  };

  // --- contratos ----------------------------------------------------------
  // Um contrato nasce de uma proposta ACEITA: a referência passa pela
  // superfície pública do Comercial. A regra "só de proposta aceita" fica no
  // caso de uso de Contratos, porque é regra de contrato, não de proposta.
  const propostasDoComercial = new CommercialService(propostasRepo);
  const diretorioDePropostas: ProposalDirectory = {
    find: (tenantId, proposalId) =>
      propostasDoComercial.findProposal(tenantId, proposalId),
  };
  const contratosRepo = new DrizzleContractRepository(db);
  const contracts: ContractsUseCases = {
    formalizar: new CreateContractUseCase(
      contratosRepo,
      diretorioDePropostas,
      audit,
    ),
    obter: new GetContractUseCase(contratosRepo),
    pesquisar: new SearchContractsUseCase(contratosRepo),
    ativar: new ActivateContractUseCase(contratosRepo, audit),
    encerrar: new CloseContractUseCase(contratosRepo, audit),
  };

  // --- ativos -------------------------------------------------------------
  // Sem dependência de outro módulo: o patrimônio existe antes de qualquer
  // contrato. Os dois repositórios andam juntos porque a disponibilidade do
  // ativo é sempre lida a partir dos bloqueios sobre ele.
  const ativosRepo = new DrizzleAssetRepository(db);
  const bloqueiosRepo = new DrizzleAssetHoldRepository(db);
  const assets: AssetsUseCases = {
    cadastrar: new RegisterAssetUseCase(ativosRepo, audit),
    atualizar: new UpdateAssetUseCase(ativosRepo, audit),
    obter: new GetAssetUseCase(ativosRepo, bloqueiosRepo),
    pesquisar: new SearchAssetsUseCase(ativosRepo, bloqueiosRepo),
    bloquear: new HoldAssetUseCase(ativosRepo, bloqueiosRepo, audit),
    liberar: new ReleaseHoldUseCase(bloqueiosRepo, audit),
    baixar: new RetireAssetUseCase(ativosRepo, bloqueiosRepo, audit),
    disponibilidade: new CheckAvailabilityUseCase(ativosRepo, bloqueiosRepo),
  };

  // --- operações ----------------------------------------------------------
  // O elo que fecha a Fase 7: a locação nasce de um contrato EM VIGOR e
  // reserva o equipamento no patrimônio. As duas referências passam pelas
  // superfícies públicas — Operações não conhece `contracts_*` nem `assets_*`.
  const contratosPublicos = new ContractsService(contratosRepo);
  const diretorioDeContratos: ContractDirectory = {
    find: async (tenantId, contractId) => {
      const contrato = await contratosPublicos.findContract(
        tenantId,
        contractId,
      );
      return (
        contrato && {
          contractId: contrato.contractId,
          number: contrato.number,
          customerId: contrato.customerId,
          title: contrato.title,
          status: contrato.status,
          startsOn: contrato.startsOn,
          endsOn: contrato.endsOn,
        }
      );
    },
  };

  // Reservar é ESCRITA em outro módulo, e passa pelos casos de uso dele: a
  // recusa de equipamento comprometido e a auditoria do bloqueio ficam num
  // lugar só, valendo igual para quem chama pelo REST, pela tool MCP ou daqui.
  const ativosPublicos = new AssetsService(
    ativosRepo,
    bloqueiosRepo,
    assets.bloquear,
    assets.liberar,
  );
  const diretorioDeAtivos: AssetDirectory = {
    find: async (tenantId, assetId) => {
      const ativo = await ativosPublicos.findAsset(tenantId, assetId);
      return (
        ativo && {
          assetId: ativo.assetId,
          code: ativo.code,
          name: ativo.name,
          availability: ativo.availability,
        }
      );
    },
    reservar: (tenantId, entrada) => ativosPublicos.reserve(tenantId, entrada),
    liberar: (tenantId, holdId) =>
      ativosPublicos.releaseReservation(tenantId, holdId),
  };

  const locacoesRepo = new DrizzleRentalRepository(db);
  const operations: OperationsUseCases = {
    programar: new ScheduleRentalUseCase(
      locacoesRepo,
      diretorioDeContratos,
      diretorioDeAtivos,
      audit,
    ),
    obter: new GetRentalUseCase(locacoesRepo),
    pesquisar: new SearchRentalsUseCase(locacoesRepo),
    retirar: new StartRentalUseCase(locacoesRepo, audit),
    devolver: new FinishRentalUseCase(locacoesRepo, diretorioDeAtivos, audit),
    cancelar: new CancelRentalUseCase(locacoesRepo, diretorioDeAtivos, audit),
  };

  return {
    handle,
    catalogo,
    tokens,
    audit,
    identity,
    crm,
    commercial,
    contracts,
    assets,
    operations,
    plugins,
    // A tool do plugin entra no MESMO catálogo das tools de módulo. Quem
    // decide se ela aparece é o entitlement `plugin.<id>`, não código de
    // exceção no gateway.
    mcp: new McpCatalog([
      crmMcpContribution(crm),
      commercialMcpContribution(commercial),
      contractsMcpContribution(contracts),
      assetsMcpContribution(assets),
      operationsMcpContribution(operations),
      notificationsMcpContribution(notificacoes, runtimeDeNotificacoes),
    ]),
    tenancy: new TenancyService(resolverAcesso, tenantsRepo),
    signIn: new SignInUseCase(identity, tenantsRepo, resolverAcesso, emissor),
    refreshSession: new RefreshSessionUseCase(
      identity,
      tenantsRepo,
      resolverAcesso,
      emissor,
    ),
    serviceToken: new IssueServiceTokenUseCase(identity, tenantsRepo, emissor),
    entitlements: new ManageEntitlementsUseCase(
      entitlementsRepo,
      audit,
      catalogo.ordered.map((manifest) => manifest.id),
    ),
  };
}
