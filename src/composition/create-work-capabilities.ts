import type { Hono } from 'hono';

import type { TeamDriver } from '../application/teams/team-driver.js';
import type { TeamExecutionRepository } from '../application/ports/team-execution-repository.js';
import {
  createChatWorkCardProjection,
  type ChatWorkCardProjection,
} from '../application/product-projection/chat-work-card-projection.js';
import { GetProductExecutionDetail } from '../application/product-projection/get-product-execution-detail.js';
import { GetProductSessionTranscripts } from '../application/product-projection/get-product-session-transcripts.js';
import {
  createProductProjection,
  type ProductProjectionApi,
} from '../application/product-projection/product-projection.js';
import { WorkProjectionFactsSource } from '../application/product-projection/work-projection-facts-source.js';
import type { ExecutionAdmission } from '../application/ports/execution-admission.js';
import type { ExecutionFactQuery } from '../application/ports/execution-fact-query.js';
import type { DefinitionReadApi } from '../application/ports/definition-read-api.js';
import type { RuntimeCapabilities } from '../application/runtime/runtime-capabilities.js';
import type { ProductWorkListQuery } from '../application/ports/product-work-list-query.js';
import type { ConversationRepository } from '../application/ports/conversation-repository.js';
import type { WorkDefinitionResolutionPort } from '../application/ports/work-definition-resolution.js';
import type { WorkIdentityOwnerScope } from '../application/ports/work-identity-repository.js';
import type { LogicalFileStore } from '../application/ports/logical-file-store.js';
import {
  StartWorkRun,
  type StartWorkRunRequest,
} from '../application/work/start-work-run.js';
import { WorkExecutionService } from '../application/work/work-execution-service.js';
import { QueryWorkProjectionFacts } from '../application/work/query-work-projection-facts.js';
import { validateProductWorkDefinition } from '../application/work/validate-product-work-definition.js';
import { WorkIdentityApi } from '../application/work/work-identity-api.js';
import { ContextViewResolver } from '../application/context/context-view-resolver.js';
import { ConversationWorkContextLink } from '../application/context/conversation-work-context-link.js';
import type { RuntimeToolContributor } from '../application/extensions/runtime-tool-catalog.js';
import { registerProductWorkCommandRoutes } from '../entrypoints/api/routes/product-work-commands.js';
import { registerProductWorkRoutes } from '../entrypoints/api/routes/product-work.js';
import { registerWorkCardRoutes } from '../entrypoints/api/routes/work-cards.js';
import { registerProductWorkMcpTools } from '../entrypoints/mcp/product-work-mcp-tools.js';
import {
  createWorkChatWakeWorker,
  PostgresWorkChatConversationAgentResolver,
  PostgresWorkChatWakeWorkSource,
  type WorkChatWakeWorker,
} from '../entrypoints/work-chat/worker.js';
import {
  PostgresWorkIdentityRepository,
  type WorkIdentityConnectable,
} from '../infrastructure/postgres/postgres-work-identity-repository.js';
import { PostgresConversationWorkLinkRepository } from './postgres-conversation-work-link-repository.js';
import { PostgresLogicalFileStore } from '../infrastructure/postgres/postgres-logical-file-store.js';
import { PostgresRunEventRepository } from '../infrastructure/postgres/postgres-run-event-repository.js';
import { PostgresSessionTranscriptFactsQuery } from '../infrastructure/postgres/postgres-session-transcript-facts-query.js';
import { PostgresWorkDefinitionSourceRepository } from '../infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresProductWorkListQuery } from '../infrastructure/postgres/postgres-product-work-list-query.js';
import { PostgresWorkProjectionFactsQuery } from '../infrastructure/postgres/postgres-work-projection-facts-query.js';
import { PostgresWorkRunInputStore } from '../infrastructure/postgres/postgres-work-run-input-store.js';
import { PostgresWorkChatWakeStateRepository } from '../infrastructure/postgres/postgres-work-chat-wake-state-repository.js';
import type { ConversationWorkLinkRepository } from '../domain/chat/chat-work-origin-ref.js';
import type { ApiEnvironment } from '../entrypoints/api/http-types.js';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import type { Pool } from 'pg';
import { PostgresExecutionFactQuery } from '../infrastructure/postgres/postgres-execution-fact-query.js';

export interface WorkModuleHttpOptions {
  readonly teamDriver?: Pick<TeamDriver, 'decideCompletion'>;
  readonly teamExecutions?: Pick<
    TeamExecutionRepository,
    'findTeamRunByRootTaskId'
  >;
}

export interface WorkModule {
  readonly identity: Pick<WorkIdentityApi, 'createWork' | 'findWorkById'>;
  readonly projection: ProductProjectionApi;
  readonly execution: WorkExecutionService;
  readonly contextFiles: LogicalFileStore;
  readonly contextViews: ContextViewResolver;
  createChatWorkCardProjection(): ChatWorkCardProjection;
  installHttp(
    app: Hono<ApiEnvironment>,
    config: AppConfig,
    extras?: WorkModuleHttpOptions,
  ): void;
  readonly contributeRuntime: RuntimeToolContributor;
}

export interface InstallWorkHttpRoutesOptions {
  readonly workIdentity: Pick<
    WorkIdentityApi,
    | 'createWork'
    | 'listWorks'
    | 'listWorkRuns'
    | 'getWorkDefinition'
    | 'updateCurrentDefinitionVersion'
    | 'getWorkRun'
  >;
  readonly productLists: ProductWorkListQuery;
  readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
  readonly projection: ProductProjectionApi;
  readonly chatWorkCard: ReturnType<typeof createChatWorkCardProjection>;
  readonly executionDetail: Pick<GetProductExecutionDetail, 'execute'>;
  readonly sessionTranscripts: Pick<GetProductSessionTranscripts, 'execute'>;
  readonly teamDriver?: Pick<TeamDriver, 'decideCompletion'>;
  readonly teamExecutions?: Pick<
    TeamExecutionRepository,
    'findTeamRunByRootTaskId'
  >;
}

export interface CreateWorkModuleOptions {
  readonly database: WorkIdentityConnectable;
  readonly definitions: Pick<
    DefinitionReadApi,
    'findTeamDefinitionById' | 'findPublishedTeamVersionById'
  >;
  readonly definitionResolution?: WorkDefinitionResolutionPort;
  readonly execution: ExecutionAdmission;
  readonly executionFacts: ExecutionFactQuery;
  readonly conversations?: Pick<ConversationRepository, 'appendMessage'>;
  readonly runtimeCapabilities: RuntimeCapabilities;
}

export function installWorkHttpRoutes(
  app: Hono<ApiEnvironment>,
  config: AppConfig,
  dependencies: InstallWorkHttpRoutesOptions,
): void {
  const {
    workIdentity,
    productLists,
    startWorkRun,
    projection,
    chatWorkCard,
    executionDetail,
    sessionTranscripts,
    teamDriver,
    teamExecutions,
  } = dependencies;
  registerProductWorkCommandRoutes(app, {
    config,
    workIdentity,
    productLists,
    startWorkRun,
    workListProjection: projection.getWorkListItem,
    workExists: projection.getWork,
    productWorkRun: projection.getWorkRun,
    ...(teamDriver ? { teamDriver } : {}),
    ...(teamExecutions ? { teamExecutions } : {}),
  });
  registerProductWorkRoutes(app, {
    config,
    productProjection: projection,
    executionDetail,
    sessionTranscripts,
  });
  registerWorkCardRoutes(app, {
    config,
    chatWorkCard,
  });
}

export function createWorkModule(options: CreateWorkModuleOptions): WorkModule {
  const repository = new PostgresWorkIdentityRepository(options.database);
  const contextFiles = new PostgresLogicalFileStore(options.database);
  const contextViews = new ContextViewResolver();
  const conversationWorkLinks = new ConversationWorkContextLink(
    new PostgresConversationWorkLinkRepository(options.database),
    contextFiles,
  );
  const productLists = new PostgresProductWorkListQuery(options.database);
  const definitionSources = new PostgresWorkDefinitionSourceRepository(
    options.database,
  );
  const workIdentity = new WorkIdentityApi({
    repository,
    definitions: options.definitions,
    ...(options.definitionResolution
      ? { definitionResolution: options.definitionResolution }
      : {}),
  });
  const startWorkRunPrimitive = new StartWorkRun({
    identity: workIdentity,
    execution: options.execution,
    runtimeCapabilities: options.runtimeCapabilities,
    productDefinitions: {
      async getInputContract({ versionId, accessContext }) {
        const productVersion = await definitionSources.findProductVersion(
          versionId,
          {
            tenantId: accessContext.tenantId,
            workspaceId: accessContext.workspaceId,
            principalType: accessContext.principalType,
            principalId: accessContext.principalId,
          },
        );
        if (!productVersion) return null;
        const parsed = validateProductWorkDefinition(
          JSON.stringify(productVersion.authorSource),
        );
        if (!parsed.valid)
          throw new Error('Persisted Product Work Definition is invalid.');
        return {
          name: parsed.document.metadata.name,
          description: parsed.document.metadata.description ?? null,
          schema: parsed.document.spec.input_schema,
        };
      },
    },
    workRunInputs: new PostgresWorkRunInputStore(options.database),
  });
  const workIdentityQuery = {
    findWorkById: (id: string, owner: WorkIdentityOwnerScope) =>
      repository.findWorkById(id, owner),
    findWorkRunById: (id: string, owner: WorkIdentityOwnerScope) =>
      repository.findWorkRunById(id, owner),
    findLatestVisibleWorkRun: (workId: string, owner: WorkIdentityOwnerScope) =>
      repository.findLatestVisibleWorkRun(workId, owner),
  };
  const workFacts = new WorkProjectionFactsSource(
    new QueryWorkProjectionFacts(
      new PostgresWorkProjectionFactsQuery(options.database),
    ),
  );
  const projection = createProductProjection({
    workIdentity: workIdentityQuery,
    workFacts,
    executionFacts: options.executionFacts,
  });
  const execution = new WorkExecutionService(
    workIdentity,
    startWorkRunPrimitive,
    projection,
  );
  const startWorkRun = {
    execute(input: StartWorkRunRequest) {
      return execution.startExistingWork(input);
    },
  };
  const chatWorkCard = createChatWorkCardProjection({
    workIdentity: workIdentityQuery,
    productProjection: projection,
  });
  const executionDetail = new GetProductExecutionDetail(
    workIdentityQuery,
    workFacts,
    options.executionFacts,
    new PostgresRunEventRepository(options.database),
  );
  const sessionTranscripts = new GetProductSessionTranscripts(
    workIdentityQuery,
    new PostgresSessionTranscriptFactsQuery(options.database),
    new PostgresRunEventRepository(options.database),
  );

  return {
    identity: workIdentity,
    projection,
    execution,
    contextFiles,
    contextViews,
    createChatWorkCardProjection() {
      return createChatWorkCardProjection({
        workIdentity: workIdentityQuery,
        productProjection: projection,
      });
    },
    installHttp(app, config, extras) {
      installWorkHttpRoutes(app, config, {
        workIdentity,
        productLists,
        startWorkRun,
        projection,
        chatWorkCard,
        executionDetail,
        sessionTranscripts,
        ...(extras?.teamDriver ? { teamDriver: extras.teamDriver } : {}),
        ...(extras?.teamExecutions
          ? { teamExecutions: extras.teamExecutions }
          : {}),
      });
    },
    contributeRuntime(context) {
      registerProductWorkMcpTools({
        ...context,
        workIdentity,
        startWorkRun,
        definitions: definitionSources,
        ...(options.conversations
          ? { conversations: options.conversations }
          : {}),
        conversationWorkLinks,
      });
    },
  };
}

export type WorkCapabilities = {
  readonly workModule?: WorkModule;
  readonly workChatWorker?: WorkChatWakeWorker;
  readonly conversationWorkLinks?: ConversationWorkLinkRepository;
};

export function createWorkExecutionFacts(
  database: Pool,
): PostgresExecutionFactQuery {
  return new PostgresExecutionFactQuery(database);
}

interface CreateWorkCapabilitiesBaseOptions {
  readonly database: Pool;
  readonly definitions: Pick<
    DefinitionReadApi,
    'findTeamDefinitionById' | 'findPublishedTeamVersionById'
  >;
  readonly definitionResolution?: WorkDefinitionResolutionPort;
  readonly conversations?: Pick<
    ConversationRepository,
    'appendMessage' | 'getChatRuntime'
  >;
  readonly runtimeCapabilities: RuntimeCapabilities;
  readonly productWorkEnabled: boolean;
  readonly directChatEnabled: boolean;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly logger: Logger;
}

export type CreateWorkCapabilitiesOptions =
  | (CreateWorkCapabilitiesBaseOptions & {
      readonly productWorkEnabled: false;
      readonly execution?: never;
      readonly executionFacts?: never;
    })
  | (CreateWorkCapabilitiesBaseOptions & {
      readonly productWorkEnabled: true;
      readonly execution: ExecutionAdmission;
      readonly executionFacts: ExecutionFactQuery;
    });

/** Creates the feature-gated Product Work capabilities and chat wake worker. */
export function createWorkCapabilities(
  options: CreateWorkCapabilitiesOptions,
): WorkCapabilities {
  if (!options.productWorkEnabled) return {};

  const workModule = createWorkModule({
    database: options.database,
    definitions: options.definitions,
    ...(options.definitionResolution
      ? { definitionResolution: options.definitionResolution }
      : {}),
    execution: options.execution,
    executionFacts: options.executionFacts,
    ...(options.directChatEnabled && options.conversations
      ? { conversations: options.conversations }
      : {}),
    runtimeCapabilities: options.runtimeCapabilities,
  });
  const conversationWorkLinks = new PostgresConversationWorkLinkRepository(
    options.database,
  );

  if (!options.directChatEnabled || !options.conversations) {
    return { workModule, conversationWorkLinks };
  }

  const workChatWorker = createWorkChatWakeWorker(
    {
      workSource: new PostgresWorkChatWakeWorkSource(options.database),
      state: new PostgresWorkChatWakeStateRepository(options.database),
      projection: workModule.createChatWorkCardProjection(),
      conversationWorkLinks,
      conversations: options.conversations,
      conversationAgentDefinitions:
        new PostgresWorkChatConversationAgentResolver(options.database),
    },
    {
      workerId: `${options.workerId}:work-chat`,
      leaseMs: options.leaseMs,
      onError: ({ phase, errorName }) => {
        options.logger.log('error', 'work_chat.wake_worker.failed', {
          phase,
          error_name: errorName,
          worker_id: `${options.workerId}:work-chat`,
        });
      },
    },
  );

  return { workModule, workChatWorker, conversationWorkLinks };
}
