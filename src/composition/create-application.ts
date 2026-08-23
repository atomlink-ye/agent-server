import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { ClaimNextRun } from '../application/runs/claim-next-run.js';
import { CompleteRun } from '../application/runs/complete-run.js';
import { ExecuteRun } from '../application/runs/execute-run.js';
import { GetTask } from '../application/tasks/get-task.js';
import { GetTaskTree } from '../application/tasks/get-task-tree.js';
import { ExecuteTeamTask } from '../application/tasks/execute-team-task.js';
import { PostgresRunDispatcher } from '../infrastructure/postgres/postgres-run-dispatcher.js';
import { CancelTask } from '../application/tasks/cancel-task.js';
import type { AppConfig, LarkCanaryEnabledConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import { ResolveLarkBinding } from '../application/channels/resolve-lark-binding.js';
import { ProcessChannelIngress } from '../application/channels/process-channel-ingress.js';
import { LarkIngressWorker } from '../entrypoints/lark/worker.js';
import { LarkOutboxWorker } from '../entrypoints/lark/outbox-worker.js';
import { createLarkWebsocketReceiver } from '../adapters/lark/lark-websocket-receiver.js';
import { createLarkDeliveryAdapter } from '../adapters/lark/lark-delivery-adapter.js';
import { larkMemoryReviewCardRenderer } from '../adapters/lark/lark-memory-card.js';
import { DeliverChannelOutbox } from '../application/channels/deliver-channel-outbox.js';
import { ProcessLarkIngress } from '../application/channels/process-lark-ingress.js';
import {
  PublishMemoryReviewSurface,
} from '../application/channels/publish-memory-review-surface.js';
import { SynthesizeMemoryDocument } from '../application/channels/synthesize-memory-document.js';
import { createLarkMemoryDocumentAdapter } from '../adapters/lark/lark-memory-document.js';
import { createMemoryReviewActionTokenDeriver } from '../application/channels/memory-review-action-token.js';
import { ApplyMemoryReviewCommand } from '../application/channels/apply-memory-review-command.js';
import { ApplyMemoryReviewControl } from '../application/channels/apply-memory-review-control.js';
import { AcceptMemoryFromBoundDocument } from '../application/channels/accept-memory-from-bound-document.js';
import { TeamDriver } from '../application/teams/team-driver.js';
import { PostgresExecutionFactQuery } from '../infrastructure/postgres/postgres-execution-fact-query.js';
import { InvokeTaskExecutionAdmission } from '../application/ports/execution-admission.js';
import { noExternalDependencies } from '../application/health/readiness.js';
import { createConfiguredRuntimeCapabilities } from './create-runtime-capabilities.js';
import { createChatCapabilities } from './create-chat-capabilities.js';
import { createMemoryCapabilities } from './create-memory-capabilities.js';
import { createKernelCapabilities } from './create-kernel-capabilities.js';
import { createInfrastructure } from './create-infrastructure.js';
import { createHttpApi } from './create-http-api.js';
import { createResourceCapabilities } from './create-resource-capabilities.js';
import { createTeamCapabilities } from './create-team-capabilities.js';
import { createWorkCapabilities } from './create-work-capabilities.js';
import { createWorkers } from './create-workers.js';
import { createLifecycleSupervisor } from './lifecycle-supervisor.js';
import type { PostgresChannelRepository } from '../infrastructure/postgres/postgres-channel-repository.js';
import type { FileStore } from '../application/ports/file-store.js';
import type { PostgresSessionRepository } from '../infrastructure/postgres/postgres-session-repository.js';
import { createRuntimeToolCatalog } from '../application/extensions/runtime-tool-catalog.js';
import { createCollaborationRuntimeContributor, createSyntheticRuntimeToolsContributor } from '../entrypoints/mcp/runtime-tool-contributors.js';
import { SyntheticMarketAdapter } from '../adapters/demo-market/synthetic-market-adapter.js';
import { PostgresRuntimeSessionStore } from '../infrastructure/postgres/runtime/postgres-runtime-session-store.js';
import { PostgresRuntimeSpecStore } from '../infrastructure/postgres/runtime/postgres-runtime-spec-store.js';
import { PostgresRuntimeGenerationStore } from '../infrastructure/postgres/runtime/postgres-runtime-generation-store.js';
import { PostgresRuntimeTurnStore } from '../infrastructure/postgres/runtime/postgres-runtime-turn-store.js';
import { PostgresRuntimeGrantReader } from '../infrastructure/postgres/runtime/postgres-runtime-grant-reader.js';
import { PostgresRuntimeGrantAuthority } from '../infrastructure/postgres/runtime/postgres-runtime-grant-authority.js';
import { AuthorizeRuntimeTool } from '../application/runtime/authorize-runtime-tool.js';
import { EnsureRuntimeSessionService } from '../application/runtime/ensure-runtime-session.js';
import { ExecuteRuntimeTurn } from '../application/runtime/execute-runtime-turn.js';
import { AgentChatRuntimeSessionCreator } from '../application/runtime/create-agent-chat-runtime-session.js';
import { ResolveRuntimeSessionSpecService } from '../application/runtime/resolve-runtime-session-spec.js';
import { RuntimeGenerationManager } from '../application/runtime/runtime-generation-manager.js';
import { createRuntimeMcpEndpoint } from './create-runtime-mcp-endpoint.js';
import { RuntimeMcpServer } from '../infrastructure/extensions/runtime-mcp-server.js';
import { createPaseoRuntimeProvider } from '../infrastructure/runtime/paseo/paseo-runtime-provider.js';
import { UnavailableRuntimeProvider } from '../infrastructure/runtime/unavailable-runtime-provider.js';
import { hashBearerToken } from '../infrastructure/security/hash-bearer-token.js';
import type { RuntimeExecutionProvider } from '../application/ports/runtime-execution-provider.js';
import type { RuntimeSessionStore } from '../application/ports/runtime-session-store.js';
import type { ResolveRuntimeSessionSpec } from '../application/ports/resolve-runtime-session-spec.js';
import type { EnsureRuntimeSession } from '../application/ports/ensure-runtime-session.js';
import type { RuntimeMcpEndpoint } from '../application/ports/runtime-mcp-endpoint.js';
import type { ExecuteRuntimeTurn as ExecuteRuntimeTurnUseCase } from '../application/runtime/execute-runtime-turn.js';
import { ExecutionRunRegistry } from '../application/runtime/execution-run-registry.js';

interface RuntimeOwner {
  readonly runtimeProvider: RuntimeExecutionProvider;
  readonly runtimeSessions: RuntimeSessionStore;
  readonly resolveRuntimeSpec: ResolveRuntimeSessionSpec;
  readonly ensureRuntimeSession: EnsureRuntimeSession;
  readonly executeRuntimeTurn: Pick<ExecuteRuntimeTurnUseCase, 'execute'>;
  readonly chatRuntime: {
    readonly sessionCreator: Pick<AgentChatRuntimeSessionCreator, 'execute'>;
    readonly turnExecutor: Pick<ExecuteRuntimeTurnUseCase, 'execute'>;
  };
  readonly runtimeMcpServer: RuntimeMcpServer;
  readonly runtimeMcpEndpoint: RuntimeMcpEndpoint;
}

function createRuntimeOwner(input: {
  readonly database: Pool;
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly toolCatalog: ReturnType<typeof createRuntimeToolCatalog>;
}): RuntimeOwner {
  const runtimeProvider = input.config.runtime?.adapter === 'none'
    ? new UnavailableRuntimeProvider()
    : createPaseoRuntimeProvider(input.config, input.logger);
  const runtimeSessions = new PostgresRuntimeSessionStore(input.database);
  const specs = new PostgresRuntimeSpecStore(input.database);
  const generations = new PostgresRuntimeGenerationStore(input.database);
  const turns = new PostgresRuntimeTurnStore(input.database);
  const grants = new PostgresRuntimeGrantAuthority(input.database);
  const reader = new PostgresRuntimeGrantReader(input.database);
  const authorizeRuntimeTool = new AuthorizeRuntimeTool(
    reader,
    runtimeSessions,
    generations,
    turns,
    hashBearerToken,
  );
  const runtimeMcpServer = new RuntimeMcpServer(
    input.toolCatalog,
    authorizeRuntimeTool,
    input.config.runtimeMcp?.listenHost,
    input.config.runtimeMcp?.advertisedHost,
    input.config.runtimeMcp?.port,
  );
  const runtimeMcpEndpoint = createRuntimeMcpEndpoint(runtimeMcpServer);
  const resolveRuntimeSpec = new ResolveRuntimeSessionSpecService(
    input.toolCatalog,
    { digest: () => input.toolCatalog.digest },
  );
  const generationManager = new RuntimeGenerationManager({
    generations,
    generationTransaction: generations,
    now: () => new Date(),
  });
  const ensureRuntimeSession = new EnsureRuntimeSessionService({
    provider: runtimeProvider,
    sessions: runtimeSessions,
    specs,
    generations,
    generationManager,
    grants,
    mcpEndpoint: createRuntimeMcpEndpoint(runtimeMcpServer),
    logger: input.logger,
    now: () => new Date(),
  });
  const executeRuntimeTurn = new ExecuteRuntimeTurn(
    turns,
    ensureRuntimeSession,
    grants,
  );
  const sessionCreator = new AgentChatRuntimeSessionCreator(
    runtimeSessions,
    resolveRuntimeSpec,
    {
      provider: input.config.paseo.provider,
      model: input.config.paseo.model ?? null,
      cwd: input.config.paseo.agentCwd,
    },
  );
  return {
    runtimeProvider,
    runtimeSessions,
    resolveRuntimeSpec,
    ensureRuntimeSession,
    executeRuntimeTurn,
    chatRuntime: { sessionCreator, turnExecutor: executeRuntimeTurn },
    runtimeMcpServer,
    runtimeMcpEndpoint,
  };
}

export function createLarkIngressWorker(
  repository: Pick<
    PostgresChannelRepository,
    'claimIngress' | 'completeIngress'
  >,
  processor: {
    execute: (
      ingress: import('../domain/channels/channel-event.js').ChannelIngress,
    ) => Promise<unknown>;
  },
  config: LarkCanaryEnabledConfig,
  logger: Logger,
  options: { readonly workerId?: string; readonly leaseMs?: number } = {},
): LarkIngressWorker {
  return new LarkIngressWorker(repository, processor, {
    workerId: options.workerId ?? `agent-server:${process.pid}:lark`,
    leaseMs: options.leaseMs ?? 30_000,
    onError: ({ phase, errorName }) => {
      logger.log('error', 'lark.ingress_worker.failed', {
        phase,
        errorName,
      });
    },
  });
}

export function createLarkOutboxWorker(
  repository: Pick<PostgresChannelRepository, 'claimOutbox'>,
  delivery: Pick<DeliverChannelOutbox, 'execute'>,
  logger: Logger,
  options: { readonly workerId?: string; readonly leaseMs?: number } = {},
): LarkOutboxWorker {
  return new LarkOutboxWorker(repository, delivery, {
    workerId: options.workerId ?? `agent-server:${process.pid}:lark-outbox`,
    leaseMs: options.leaseMs ?? 30_000,
    onError: ({ phase, errorName }) => {
      logger.log('error', 'lark.outbox_worker.failed', { phase, errorName });
    },
  });
}

export interface SingleRunDebugControl {
  claimAndExecute(runId: string): Promise<{
    readonly claimed: boolean;
    readonly terminalStatus?: string;
  }>;
  rebuildQueuedTeamWakes(): Promise<number>;
  startDispatcher(): void;
  stopDispatcher(): Promise<void>;
}

export interface CreateServiceOptions {
  /** Debug-only seam for retained, manually stepped fixtures. */
  readonly singleRunDebug?: boolean;
  /** Keep terminal Team wakes durable until the debug control resumes them. */
  readonly deferTeamWakeReconcile?: boolean;
  /** Explicit infrastructure/runtime seams retained for deterministic fixtures. */
  readonly database?: Pool;
  readonly fileStore?: FileStore;
  readonly memoryReviewNotifier?: Pick<PublishMemoryReviewSurface, 'execute'>;
}

export interface ApplicationControls {
  readonly dispatcher: PostgresRunDispatcher;
  readonly sessions: PostgresSessionRepository;
  readonly memoryModule: ReturnType<typeof createMemoryCapabilities>;
}

function turnLeaseDurationMs(executionTimeoutMs: number): number {
  return Math.max(executionTimeoutMs * 2 + 300_000, 30_000);
}

export async function createApplication(
  config: AppConfig,
  logger: Logger,
  options: CreateServiceOptions = {},
) {
  if (options.deferTeamWakeReconcile && !options.singleRunDebug)
    throw new Error('Debug service options require singleRunDebug.');
  const workerId = `agent-server:${process.pid}:${randomUUID()}`;
  const leaseDurationMs = turnLeaseDurationMs(config.paseo.executionTimeoutMs);
  const pool =
    options.database ?? (await createInfrastructure(config, logger)).pool;
  const resourceModule = await createResourceCapabilities({
    database: pool,
    config,
  });

  const directChatPlane = config.directChatPlane;
  const productWorkPlane = config.productWorkPlane;
  const directChatEnabled = directChatPlane !== 'absent';
  const productWorkEnabled = productWorkPlane !== 'absent';
  const {
    runRepository,
    taskRepository,
    admissionRepository,
    sessions,
    conversations,
    conversationWorkEntitlements,
    chatDispatches,
    submitSessionTurn,
    channelRepository,
    reviewSurfaceRepository,
    events,
    admitRootTask,
    submitRun,
    getRun,
    invokeTask,
  } = createKernelCapabilities({
    pool,
    config,
    definitionReadApi: resourceModule.definitionReadApi,
    agentResolutionApi: resourceModule.agentResolutionApi,
  });
  const teamModule = createTeamCapabilities({
    database: pool,
    tasks: taskRepository,
    runs: runRepository,
    admissions: admissionRepository,
    events,
    logger,
    ...(options.deferTeamWakeReconcile === undefined
      ? {}
      : { deferActivationKick: options.deferTeamWakeReconcile }),
  });
  const {
    executions: collaborativeTeamExecutions,
    messages: teamMessages,
    contextResolver: teamToolContextResolver,
    activationReconciler: collaborationActivationReconciler,
    collaboration,
  } = teamModule;
  const memoryModule = createMemoryCapabilities({
    database: pool,
    tasks: taskRepository,
    sessions,
    config,
    ...(options.fileStore ? { fileStore: options.fileStore } : {}),
    teamTools: { contextResolver: teamToolContextResolver },
  });
  const reviewTokenDeriver = config.larkCanary?.enabled
    ? createMemoryReviewActionTokenDeriver(config.larkCanary.appSecret)
    : undefined;
  const memoryDocument = config.larkCanary?.enabled
    ? createLarkMemoryDocumentAdapter(config.larkCanary)
    : undefined;
  const memoryReviewSurface = config.larkCanary?.enabled
    ? new PublishMemoryReviewSurface(
        memoryModule.reviewApi.workspaceMemory,
        channelRepository,
        channelRepository,
        config.larkCanary.connectionKey,
        reviewSurfaceRepository,
        reviewTokenDeriver,
        memoryDocument,
        config.larkCanary.allowedOpenId,
      )
    : undefined;
  const runtimeCapabilities = createConfiguredRuntimeCapabilities(config);
  const {
    workModule,
    workChatWorker,
    conversationWorkLinks,
  } = createWorkCapabilities({
    database: pool,
    definitions: resourceModule.definitionReadApi,
    definitionResolution: resourceModule.workDefinitionResolution,
    ...(productWorkEnabled
      ? {
          execution: new InvokeTaskExecutionAdmission(invokeTask),
          executionFacts: new PostgresExecutionFactQuery(pool),
          productWorkEnabled: true as const,
        }
      : { productWorkEnabled: false as const }),
    ...(directChatEnabled && conversations ? { conversations } : {}),
    runtimeCapabilities,
    directChatEnabled,
    workerId,
    leaseMs: leaseDurationMs,
    logger,
  });
  const runtimeToolCatalog = createRuntimeToolCatalog([
    { ref: 'memory', contribute: memoryModule.contributeRuntime },
    {
      ref: 'collaboration',
      contribute: createCollaborationRuntimeContributor({
        contextResolver: teamToolContextResolver,
        kernel: collaboration,
      }),
    },
    {
      ref: 'synthetic',
      contribute: createSyntheticRuntimeToolsContributor({
        market: new SyntheticMarketAdapter(),
        logger,
      }),
    },
    ...(workModule
      ? [{ ref: 'work', contribute: workModule.contributeRuntime }]
      : []),
  ]);
  const runtimeOwner = createRuntimeOwner({
    database: pool,
    config,
    logger,
    toolCatalog: runtimeToolCatalog,
  });
  const {
    runtimeProvider,
    runtimeSessions,
    resolveRuntimeSpec,
    runtimeMcpServer,
    chatRuntime,
  } = runtimeOwner;
  const executionRuns = new ExecutionRunRegistry();
  const chatCapabilities =
    directChatPlane === 'absent'
      ? createChatCapabilities({ directChatPlane })
      : createChatCapabilities({
          directChatPlane,
          database: pool,
          chatRuntime,
          conversations: conversations!,
          chatDispatches: chatDispatches!,
          managedAgentDefinitions: resourceModule.managedAgentDefinitions,
          agentResolutionApi: resourceModule.agentResolutionApi,
          conversationWorkLinks,
          logger,
          conversationWorkEntitlements,
          workerId,
          leaseMs: leaseDurationMs,
        });
  const synthesizeMemoryDocument = new SynthesizeMemoryDocument(
    executionRuntime,
  );
  const acceptMemoryFromDocument = new AcceptMemoryFromBoundDocument(
    executionRuntime,
    events,
    memoryModule.reviewApi.review,
    memoryModule.reviewApi.managedMemory,
    process.env.LARK_CLI_PROFILE ?? 'agent-test',
  );
  const cancelTask = new CancelTask(
    taskRepository,
    runRepository,
    executionRuns,
    events,
  );
  const getTask = new GetTask(taskRepository);
  const getTaskTree = new GetTaskTree(taskRepository);
  const terminalActivationReconciler = options.deferTeamWakeReconcile
    ? undefined
    : collaborationActivationReconciler;
  const teamDriver = new TeamDriver(
    collaborativeTeamExecutions,
    taskRepository,
    runRepository,
    admissionRepository,
    teamMessages,
    terminalActivationReconciler,
    undefined,
    { completionApprovalRequired: config.teamCompletionApprovalRequired },
  );
  const completeRun = new CompleteRun(
    runRepository,
    taskRepository,
    events,
    sessions,
    memoryReviewSurface
      ? { notifySucceeded: (input) => memoryReviewSurface.execute(input) }
      : options.memoryReviewNotifier
        ? { notifySucceeded: (input) => options.memoryReviewNotifier!.execute(input) }
      : undefined,
    {
      handleTerminalRun: async ({ run, task }) => {
        const team = await collaborativeTeamExecutions.findTeamRunByRootTaskId(
          task.rootTaskId,
          {
            tenantId: task.tenantId,
            workspaceId: task.workspaceId,
            principalType: task.principalType,
            principalId: task.principalId,
          },
        );
        if (team) {
          await teamDriver.handleTerminalRun({ team, task, run });
          const terminal = await collaborativeTeamExecutions.findTeamRunById(
            team.id,
            {
              tenantId: task.tenantId,
              workspaceId: task.workspaceId,
              principalType: task.principalType,
              principalId: task.principalId,
            },
          );
        }
      },
    },
  );
  const executeTeamTask = new ExecuteTeamTask(
    resourceModule.definitionReadApi,
    teamDriver,
  );
  const executeRun = new ExecuteRun({
    completeRun,
    tasks: taskRepository,
    definitions: resourceModule.definitionReadApi,
    executeTeamTask,
    runtime: executionRuntime,
    runtimeProvider,
    logger,
    resolver: resourceModule.agentResolutionApi,
    events,
    fileStore: memoryModule.fileStore,
    createMemoryProposal: memoryModule.createMemoryProposal,
    sessions,
    runtimeSessions,
    resolveRuntimeSpec,
    environments: resourceModule.environmentReadApi,
    collaborativeExecutions: collaborativeTeamExecutions,
    runs: runRepository,
    ...(terminalActivationReconciler
      ? { activationReconciler: terminalActivationReconciler }
      : {}),
  });
  const dispatcher = new PostgresRunDispatcher(
    new ClaimNextRun(runRepository, {
      workerId,
      leaseDurationMs,
    }),
    executeRun,
    logger,
    {
      concurrency: config.dispatcher?.concurrency ?? 4,
      onIdleMaintenance: async () => {
        try {
          const recovered =
            await collaborativeTeamExecutions.recoverExpiredTeamRuns(
              new Date().toISOString(),
            );
          for (const item of recovered) {
            logger.log('warn', 'team.recovery.fail_closed', {
              team_run_id: item.teamRunId,
              child_run_id: item.childRunId,
              team_task_kind: item.teamTaskKind,
              affected_child_run_count: item.affectedChildRunCount,
            });
          }
        } catch (error) {
          logger.log('error', 'team.recovery.fail_closed_failed', {
            error_name: error instanceof Error ? error.name : 'UnknownError',
          });
        }
        try {
          await collaborationActivationReconciler.reconcilePendingRoots();
        } catch (error) {
          logger.log('error', 'team.wake_reconcile_failed', {
            error_name: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      },
    },
  );
  let larkWorker: LarkIngressWorker | undefined;
  let larkOutboxWorker: LarkOutboxWorker | undefined;
  let larkReceiver: ReturnType<typeof createLarkWebsocketReceiver> | undefined;
  if (config.larkCanary?.enabled) {
    const larkConfig = config.larkCanary;
    const processMessages = new ProcessChannelIngress(
      new ResolveLarkBinding(channelRepository, larkConfig),
      submitSessionTurn,
      channelRepository,
      larkConfig,
    );
    const processIngress = new ProcessLarkIngress(
      processMessages,
      new ApplyMemoryReviewCommand(
        channelRepository,
        memoryModule.reviewApi.review,
        memoryModule.reviewApi.managedMemory,
        larkConfig,
      ),
      new ApplyMemoryReviewControl(
        channelRepository,
        reviewSurfaceRepository,
        memoryModule.reviewApi.review,
        memoryModule.reviewApi.managedMemory,
        larkConfig,
        larkMemoryReviewCardRenderer,
        memoryDocument,
        synthesizeMemoryDocument,
        acceptMemoryFromDocument,
      ),
    );
    larkWorker = createLarkIngressWorker(
      channelRepository,
      processIngress,
      larkConfig,
      logger,
      {
        workerId: `${workerId}:lark`,
        leaseMs: leaseDurationMs,
      },
    );
    larkOutboxWorker = createLarkOutboxWorker(
      channelRepository,
      new DeliverChannelOutbox(
        createLarkDeliveryAdapter(larkConfig),
        channelRepository,
        {
          cards: larkMemoryReviewCardRenderer,
          tokenDeriver: reviewTokenDeriver!,
          validateCardPublication: (input) =>
            reviewSurfaceRepository.validateCardPublication(input),
          finalizeCardDelivery: (input) =>
            reviewSurfaceRepository.finalizeCardDelivery(input),
          ...(larkConfig.docWebBaseUrl
            ? { docWebBaseUrl: larkConfig.docWebBaseUrl }
            : {}),
        },
      ),
      logger,
      {
        workerId: `${workerId}:lark-outbox`,
        leaseMs: leaseDurationMs,
      },
    );
    larkReceiver = createLarkWebsocketReceiver({
      config: larkConfig,
      repository: channelRepository,
    });
  }
  const readiness = noExternalDependencies;
  const app = createHttpApi({
    config,
    logger,
    readiness,
    runtime: runtimeProvider,
    submitRun,
    getRun,
    invokeTask,
    getTask,
    getTaskTree,
    teamExecutions: collaborativeTeamExecutions,
    teamDriver,
    teamMessages,
    tasks: taskRepository,
    sessions,
    ...(conversations ? { conversations } : {}),
    ...(chatDispatches ? { chatDispatches } : {}),
    ...(conversationWorkEntitlements ? { conversationWorkEntitlements } : {}),
    submitSessionTurn,
    events,
    cancelTask,
    ...(workModule ? { workModule } : {}),
    memoryModule,
    resourceModule,
  });
  const workers = createWorkers({
    ...(larkWorker ? { larkWorker } : {}),
    ...(larkOutboxWorker ? { larkOutboxWorker } : {}),
    ...(chatCapabilities.chatWorker
      ? { chatWorker: chatCapabilities.chatWorker }
      : {}),
    ...(workChatWorker ? { workChatWorker } : {}),
    ...(larkReceiver ? { larkReceiver } : {}),
  });
  const lifecycle = createLifecycleSupervisor({
    dispatcher,
    ...workers,
    runtimeProvider,
    runtimeMcpServer,
    pool,
  });
  if (!options.singleRunDebug) {
    await collaborationActivationReconciler.reconcilePendingRoots();
    await lifecycle.start();
  }

  const singleRunDebug: SingleRunDebugControl | undefined =
    options.singleRunDebug
      ? {
          claimAndExecute: async (runId) => {
            const claimedAt = new Date();
            const claim = await runRepository.claimQueuedById({
              runId,
              workerId,
              activationId: randomUUID(),
              claimedAt: claimedAt.toISOString(),
              leaseExpiresAt: new Date(
                claimedAt.getTime() + leaseDurationMs,
              ).toISOString(),
            });
            if (!claim) return { claimed: false };
            await executeRun.execute(claim);
            const terminal = await runRepository.findById(runId);
            return {
              claimed: true,
              ...(terminal ? { terminalStatus: terminal.status } : {}),
            };
          },
          rebuildQueuedTeamWakes: () =>
            collaborationActivationReconciler.reconcilePendingRoots(),
          startDispatcher: () => dispatcher.start(),
          stopDispatcher: () => dispatcher.stop(),
        }
      : undefined;

  return {
    app,
    controls: { dispatcher, sessions, memoryModule } satisfies ApplicationControls,
    ...(singleRunDebug ? { singleRunDebug } : {}),
    close: () => lifecycle.stop(),
  };
}

export const createService = createApplication;
