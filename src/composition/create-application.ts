import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { ClaimNextRun } from '../application/runs/claim-next-run.js';
import { CompleteRun } from '../application/runs/complete-run.js';
import { GetTask } from '../application/tasks/get-task.js';
import { GetTaskTree } from '../application/tasks/get-task-tree.js';
import { ExecuteTeamTask } from '../application/tasks/execute-team-task.js';
import { PostgresRunDispatcher } from '../infrastructure/postgres/postgres-run-dispatcher.js';
import { CancelTask } from '../application/tasks/cancel-task.js';
import type { AppConfig } from '../shared/config.js';
import type { Logger } from '../shared/observability/logger.js';
import {
  PublishMemoryReviewSurface,
} from '../application/channels/publish-memory-review-surface.js';
import { createLarkMemoryDocumentAdapter } from '../adapters/lark/lark-memory-document.js';
import { createMemoryReviewActionTokenDeriver } from '../application/channels/memory-review-action-token.js';
import { TeamDriver } from '../application/teams/team-driver.js';
import { PostgresExecutionFactQuery } from '../infrastructure/postgres/postgres-execution-fact-query.js';
import { InvokeTaskExecutionAdmission } from '../application/ports/execution-admission.js';
import { noExternalDependencies } from '../application/health/readiness.js';
import { createConfiguredRuntimeCapabilities } from './create-runtime-capabilities.js';
import {
  createChatExecutionConsumer,
  createMemoryChannelExecutionConsumers,
  createRunExecutionConsumer,
} from './create-execution-consumers.js';
import {
  createLarkChannelWorkers,
  type LarkChannelWorkers,
} from './create-lark-channel-workers.js';
import { createApplicationLifecycle } from './create-application-lifecycle.js';
import { createApplicationHttp } from './create-application-http.js';
import { createMemoryCapabilities } from './create-memory-capabilities.js';
import { createKernelCapabilities } from './create-kernel-capabilities.js';
import { createInfrastructure } from './create-infrastructure.js';
import { createResourceCapabilities } from './create-resource-capabilities.js';
import { createTeamCapabilities } from './create-team-capabilities.js';
import { createWorkCapabilities } from './create-work-capabilities.js';
import { createWorkers } from './create-workers.js';
import type { FileStore } from '../application/ports/file-store.js';
import type { PostgresSessionRepository } from '../infrastructure/postgres/postgres-session-repository.js';
import { createRuntimeToolCatalog } from '../application/extensions/runtime-tool-catalog.js';
import { createCollaborationRuntimeContributor, createSyntheticRuntimeToolsContributor } from '../entrypoints/mcp/runtime-tool-contributors.js';
import { SyntheticMarketAdapter } from '../adapters/demo-market/synthetic-market-adapter.js';
import { ExecutionRunRegistry } from '../application/runtime/execution-run-registry.js';
import { createRuntimeOwner } from './create-runtime-owner.js';

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
    events,
    channelRepository,
    reviewSurfaceRepository,
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
      ? createChatExecutionConsumer({ directChatPlane })
      : createChatExecutionConsumer({
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
  const memoryChannelConsumers = createMemoryChannelExecutionConsumers({
    runtime: executionRuntime,
    acceptRuntime: executionRuntime,
    review: memoryModule.reviewApi.review,
    managedMemory: memoryModule.reviewApi.managedMemory,
    profile: process.env.LARK_CLI_PROFILE ?? 'agent-test',
  });
  const {
    synthesizeMemoryDocument,
    acceptMemoryFromDocument,
  } = memoryChannelConsumers;
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
  const executeRun = createRunExecutionConsumer({
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
  let larkWorker: LarkChannelWorkers['larkWorker'] | undefined;
  let larkOutboxWorker: LarkChannelWorkers['larkOutboxWorker'] | undefined;
  let larkReceiver: LarkChannelWorkers['larkReceiver'] | undefined;
  if (config.larkCanary?.enabled) {
    const larkConfig = config.larkCanary;
    if (!memoryReviewSurface || !reviewTokenDeriver)
      throw new Error('lark_review_surface_unavailable');
    const larkWorkers = createLarkChannelWorkers({
      config: larkConfig,
      repository: channelRepository,
      submitSessionTurn,
      reviewSurface: reviewSurfaceRepository,
      review: memoryModule.reviewApi.review,
      managedMemory: memoryModule.reviewApi.managedMemory,
      memoryDocument,
      synthesizeMemoryDocument,
      acceptMemoryFromDocument,
      reviewTokenDeriver,
      workerId,
      leaseMs: leaseDurationMs,
      logger,
    });
    larkWorker = larkWorkers.larkWorker;
    larkOutboxWorker = larkWorkers.larkOutboxWorker;
    larkReceiver = larkWorkers.larkReceiver;
  }
  const readiness = noExternalDependencies;
  const app = createApplicationHttp({
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
  const lifecycle = createApplicationLifecycle({
    dispatcher,
    workers,
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
