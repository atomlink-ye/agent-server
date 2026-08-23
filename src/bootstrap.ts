import { randomUUID } from 'node:crypto';

import type { ExecutionRuntimeService } from './application/ports/execution-runtime.js';
import type { RunDispatcher } from './application/ports/run-dispatcher.js';
import { ClaimNextRun } from './application/runs/claim-next-run.js';
import { CompleteRun } from './application/runs/complete-run.js';
import { ExecuteRun } from './application/runs/execute-run.js';
import { GetRun } from './application/runs/get-run.js';
import { SubmitRun } from './application/runs/submit-run.js';
import { AdmitRootTask } from './application/tasks/admit-root-task.js';
import { GetTask } from './application/tasks/get-task.js';
import { GetTaskTree } from './application/tasks/get-task-tree.js';
import { ExecuteTeamTask } from './application/tasks/execute-team-task.js';
import { InvokeTask } from './application/tasks/invoke-task.js';
import { createApp } from './entrypoints/api/app.js';
import { PostgresAdmissionRepository } from './infrastructure/postgres/postgres-admission-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from './infrastructure/postgres/postgres.js';
import { PostgresRunDispatcher } from './infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresRunRepository } from './infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from './infrastructure/postgres/postgres-task-repository.js';
import { PostgresSessionRepository } from './infrastructure/postgres/postgres-session-repository.js';
import { PostgresRunEventRepository } from './infrastructure/postgres/postgres-run-event-repository.js';
import { PostgresConversationRepository } from './infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from './infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { PostgresChatDispatchRepository } from './infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { CancelTask } from './application/tasks/cancel-task.js';
import type { AppConfig, LarkCanaryEnabledConfig } from './shared/config.js';
import type { Logger } from './shared/observability/logger.js';
import { SubmitSessionTurn } from './application/sessions/submit-session-turn.js';
import { ResolveLarkBinding } from './application/channels/resolve-lark-binding.js';
import { ProcessChannelIngress } from './application/channels/process-channel-ingress.js';
import { LarkIngressWorker } from './entrypoints/lark/worker.js';
import { LarkOutboxWorker } from './entrypoints/lark/outbox-worker.js';
import { createLarkWebsocketReceiver } from './adapters/lark/lark-websocket-receiver.js';
import { createLarkDeliveryAdapter } from './adapters/lark/lark-delivery-adapter.js';
import { larkMemoryReviewCardRenderer } from './adapters/lark/lark-memory-card.js';
import { PostgresChannelRepository } from './infrastructure/postgres/postgres-channel-repository.js';
import { PostgresLarkReviewSurfaceRepository } from './infrastructure/postgres/postgres-lark-review-surface-repository.js';
import { DeliverChannelOutbox } from './application/channels/deliver-channel-outbox.js';
import { ProcessLarkIngress } from './application/channels/process-lark-ingress.js';
import { PublishMemoryReviewSurface } from './application/channels/publish-memory-review-surface.js';
import { SynthesizeMemoryDocument } from './application/channels/synthesize-memory-document.js';
import { createLarkMemoryDocumentAdapter } from './adapters/lark/lark-memory-document.js';
import { createMemoryReviewActionTokenDeriver } from './application/channels/memory-review-action-token.js';
import { ApplyMemoryReviewCommand } from './application/channels/apply-memory-review-command.js';
import { ApplyMemoryReviewControl } from './application/channels/apply-memory-review-control.js';
import { AcceptMemoryFromBoundDocument } from './application/channels/accept-memory-from-bound-document.js';
import { createRuntimeToolCatalog } from './application/extensions/runtime-tool-catalog.js';
import {
  createCollaborationRuntimeContributor,
  createSyntheticRuntimeToolsContributor,
} from './entrypoints/mcp/runtime-tool-contributors.js';
import { SyntheticMarketAdapter } from './adapters/demo-market/synthetic-market-adapter.js';
import { TeamDriver } from './application/teams/team-driver.js';
import {
  revokeForRecoveredTeamRuns,
  revokeForTerminalTeamRun,
} from './application/teams/runtime-grant-lifecycle.js';
import { ensureServiceAccountWorkspaces } from './infrastructure/postgres/postgres-service-account-workspace-bootstrap.js';
import { PostgresExecutionFactQuery } from './infrastructure/postgres/postgres-execution-fact-query.js';
import { InvokeTaskExecutionAdmission } from './application/ports/execution-admission.js';
import { createMemoryModule } from './modules/memory/memory-module.js';
import { createResourceModule } from './modules/resource/resource-module.js';
import { createRuntimeModule } from './modules/runtime/runtime-module.js';
import { createTeamModule } from './modules/team/team-module.js';
import { createWorkModule } from './modules/work/work-module.js';
import { ChatDeliveryReconciler } from './application/chat/chat-delivery-reconciler.js';
import { MockChatTurnProvider } from './adapters/chat/mock-chat-turn-provider.js';
import { ExecutionRuntimeChatTurnProvider } from './adapters/chat/execution-runtime-chat-turn-provider.js';
import { ChatDeliveryWorker } from './entrypoints/chat/worker.js';
import {
  createWorkChatWakeWorker,
  PostgresWorkChatConversationAgentResolver,
  PostgresWorkChatWakeWorkSource,
  type WorkChatWakeWorker,
} from './entrypoints/work-chat/worker.js';
import { PostgresWorkChatWakeStateRepository } from './infrastructure/postgres/postgres-work-chat-wake-state-repository.js';
import { PostgresConversationWorkLinkRepository } from './modules/work/conversation-work-link-repository.js';
import { ChatBrainResolver } from './application/chat/chat-brain-resolver.js';
import { ListAgentHomeEntries } from './application/agents/agent-home.js';
import { PostgresAgentHomeRepository } from './infrastructure/postgres/postgres-agent-home-repository.js';
import { PostgresAgentHomeDefinitionSource } from './infrastructure/postgres/postgres-agent-home-definition-source.js';
import { noExternalDependencies } from './application/health/readiness.js';
import { createConfiguredRuntimeCapabilities } from './composition/create-runtime-capabilities.js';
import {
  closeRuntimeAndPool,
  createLifecycleSupervisor,
} from './composition/lifecycle-supervisor.js';
import type { ConversationWorkLinkRepository } from './domain/chat/chat-work-origin-ref.js';

export function createLarkIngressWorker(
  repository: Pick<
    PostgresChannelRepository,
    'claimIngress' | 'completeIngress'
  >,
  processor: {
    execute: (
      ingress: import('./domain/channels/channel-event.js').ChannelIngress,
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
  /** Debug-only runtime substitute; production composition selects config.runtime.adapter. */
  readonly debugRuntime?: ExecutionRuntimeService;
  /** Keep terminal Team wakes durable until the debug control resumes them. */
  readonly deferTeamWakeReconcile?: boolean;
}

export async function createService(
  config: AppConfig,
  logger: Logger,
  options: CreateServiceOptions = {},
) {
  if (
    (options.debugRuntime || options.deferTeamWakeReconcile) &&
    !options.singleRunDebug
  )
    throw new Error('Debug service options require singleRunDebug.');
  const workerId = `agent-server:${process.pid}:${randomUUID()}`;
  const leaseDurationMs = turnLeaseDurationMs(config.paseo.executionTimeoutMs);
  const pool = createPostgresPool();
  pool.on('error', (error) => {
    logger.log('error', 'postgres.pool.error', {
      error_name: error instanceof Error ? error.name : 'UnknownError',
    });
  });
  await applyDurableKernelMigrations(pool);
  await ensureServiceAccountWorkspaces(pool, config.serviceAccounts ?? []);
  const resourceModule = await createResourceModule({
    database: pool,
    config,
  });

  const runRepository = new PostgresRunRepository(pool);
  const taskRepository = new PostgresTaskRepository(pool);
  const admissionRepository = new PostgresAdmissionRepository(pool);
  const sessions = new PostgresSessionRepository(pool);
  const directChatPlane = config.directChatPlane;
  const productWorkPlane = config.productWorkPlane;
  const directChatEnabled = directChatPlane !== 'absent';
  const productWorkEnabled = productWorkPlane !== 'absent';
  const conversations = directChatEnabled
    ? new PostgresConversationRepository(pool)
    : undefined;
  const conversationWorkEntitlements =
    directChatEnabled && productWorkEnabled
      ? new PostgresConversationWorkEntitlementRepository(pool)
      : undefined;
  const chatDispatches = directChatEnabled
    ? new PostgresChatDispatchRepository(pool)
    : undefined;
  const submitSessionTurn = new SubmitSessionTurn(sessions);
  const channelRepository = new PostgresChannelRepository(pool);
  const reviewSurfaceRepository = new PostgresLarkReviewSurfaceRepository(pool);
  const events = new PostgresRunEventRepository(pool);
  const teamModule = createTeamModule({
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
  const memoryModule = createMemoryModule({
    database: pool,
    tasks: taskRepository,
    sessions,
    config,
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
  const admitRootTask = new AdmitRootTask(
    taskRepository,
    runRepository,
    admissionRepository,
  );
  const submitRun = new SubmitRun(admitRootTask, runRepository);
  const getRun = new GetRun(runRepository);
  const invokeTask = new InvokeTask(
    admissionRepository,
    resourceModule.definitionReadApi,
    resourceModule.agentResolutionApi,
  );
  let workModule: ReturnType<typeof createWorkModule> | undefined;
  let workChatWorker: WorkChatWakeWorker | undefined;
  let conversationWorkLinks: ConversationWorkLinkRepository | undefined =
    undefined;
  const runtimeCapabilities = createConfiguredRuntimeCapabilities(config);
  if (productWorkEnabled) {
    workModule = createWorkModule({
      database: pool,
      definitions: resourceModule.definitionReadApi,
      definitionResolution: resourceModule.workDefinitionResolution,
      execution: new InvokeTaskExecutionAdmission(invokeTask),
      executionFacts: new PostgresExecutionFactQuery(pool),
      ...(directChatEnabled && conversations ? { conversations } : {}),
      runtimeCapabilities,
    });
    const productConversationWorkLinks =
      new PostgresConversationWorkLinkRepository(pool);
    conversationWorkLinks = productConversationWorkLinks;
    if (directChatEnabled && conversations) {
      const chatWorkCardProjection = workModule.createChatWorkCardProjection();
      workChatWorker = createWorkChatWakeWorker(
        {
          workSource: new PostgresWorkChatWakeWorkSource(pool),
          state: new PostgresWorkChatWakeStateRepository(pool),
          projection: chatWorkCardProjection,
          conversationWorkLinks: productConversationWorkLinks,
          conversations,
          conversationAgentDefinitions:
            new PostgresWorkChatConversationAgentResolver(pool),
        },
        {
          workerId: `${workerId}:work-chat`,
          leaseMs: leaseDurationMs,
          onError: ({ phase, errorName }) => {
            logger.log('error', 'work_chat.wake_worker.failed', {
              phase,
              error_name: errorName,
              worker_id: `${workerId}:work-chat`,
            });
          },
        },
      );
    }
  }
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
  const runtimeModule = createRuntimeModule({
    database: pool,
    config,
    logger,
    toolCatalog: runtimeToolCatalog,
    ...(options.debugRuntime ? { debugRuntime: options.debugRuntime } : {}),
  });
  const runtimeRequiresReadiness =
    directChatPlane === 'execution_runtime' ||
    productWorkPlane === 'execution_runtime';
  if (
    !options.singleRunDebug &&
    runtimeRequiresReadiness &&
    config.runtime?.adapter === 'none'
  ) {
    await closeRuntimeAndPool(runtimeModule.executionRuntime, pool);
    throw new Error(
      'Declared Direct Chat/Product Work execution runtime requires a runtime adapter.',
    );
  }
  if (!options.singleRunDebug && runtimeRequiresReadiness) {
    const ready = await runtimeModule.executionRuntime.ensureReady();
    if (!ready) {
      await closeRuntimeAndPool(runtimeModule.executionRuntime, pool);
      throw new Error(
        'Declared Direct Chat/Product Work execution runtime is not ready.',
      );
    }
  }
  const {
    executionRuntime,
    executionRuns,
    sessions: runtimeSessions,
    extensions: runtimeExtensionBinder,
    mcpHost: runtimeMcpServer,
  } = runtimeModule;
  let chatWorker: ChatDeliveryWorker | undefined;
  if (directChatEnabled && conversations && chatDispatches) {
    const chatTurnProvider =
      directChatPlane === 'execution_runtime'
        ? new ExecutionRuntimeChatTurnProvider(executionRuntime)
        : new MockChatTurnProvider();
    const chatBrainResolver = new ChatBrainResolver(
      resourceModule.managedAgentDefinitions,
      resourceModule.agentResolutionApi,
      new ListAgentHomeEntries(
        new PostgresAgentHomeRepository(pool),
        new PostgresAgentHomeDefinitionSource(pool),
      ),
    );
    const chatDeliveryReconciler = new ChatDeliveryReconciler(
      conversations,
      chatDispatches,
      chatTurnProvider,
      chatBrainResolver,
      conversationWorkLinks,
      logger,
      undefined,
      conversationWorkEntitlements,
      runtimeExtensionBinder,
    );
    chatWorker = new ChatDeliveryWorker(
      chatDispatches,
      chatDeliveryReconciler,
      {
        workerId: `${workerId}:chat`,
        leaseMs: leaseDurationMs,
        onError: ({ phase, errorName, error }) => {
          logger.log('error', 'chat.delivery_worker.failed', {
            phase,
            error_name: errorName,
            error_message: error instanceof Error ? error.message : undefined,
            error_stack: error instanceof Error ? error.stack : undefined,
            postgres_code:
              typeof (error as { code?: unknown })?.code === 'string'
                ? (error as { code: string }).code
                : undefined,
            worker_id: `${workerId}:chat`,
          });
        },
      },
    );
  }
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
          revokeForTerminalTeamRun({
            teamRunId: team.id,
            status: terminal?.status,
            revokeForTeamRun: (teamRunId) =>
              runtimeExtensionBinder.revokeForTeamRun(teamRunId),
          });
        }
      },
    },
  );
  const executeTeamTask = new ExecuteTeamTask(
    resourceModule.definitionReadApi,
    teamDriver,
  );
  const executeRun = new ExecuteRun(
    completeRun,
    taskRepository,
    resourceModule.definitionReadApi,
    executeTeamTask,
    executionRuntime,
    logger,
    undefined,
    resourceModule.agentResolutionApi,
    events,
    memoryModule.fileStore,
    memoryModule.createMemoryProposal,
    runtimeExtensionBinder,
    runtimeSessions,
    sessions,
    resourceModule.environmentReadApi,
    runtimeModule.runtimeCellRoot,
    collaborativeTeamExecutions,
    runRepository,
    terminalActivationReconciler,
  );
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
          revokeForRecoveredTeamRuns(recovered, (teamRunId) =>
            runtimeExtensionBinder.revokeForTeamRun(teamRunId),
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
  const readiness = runtimeRequiresReadiness
    ? runtimeModule.readiness
    : noExternalDependencies;
  const app = createApp({
    config,
    logger,
    readiness,
    runtime: executionRuntime,
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
  const lifecycle = createLifecycleSupervisor({
    dispatcher,
    ...(larkWorker ? { larkWorker } : {}),
    ...(larkOutboxWorker ? { larkOutboxWorker } : {}),
    ...(chatWorker ? { chatWorker } : {}),
    ...(workChatWorker ? { workChatWorker } : {}),
    ...(larkReceiver ? { larkReceiver } : {}),
    runtime: executionRuntime,
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
    runtime: executionRuntime,
    ...(singleRunDebug ? { singleRunDebug } : {}),
    close: () => lifecycle.stop(),
  };
}
