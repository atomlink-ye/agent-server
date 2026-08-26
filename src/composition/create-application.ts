import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type { PostgresRunDispatcher } from '../infrastructure/postgres/postgres-run-dispatcher.js';
import type { AppConfig } from '../shared/config.js';
import type { PublishMemoryReviewSurface } from '../application/channels/publish-memory-review-surface.js';
import type { Logger } from '../shared/observability/logger.js';
import { createConfiguredRuntimeCapabilities } from './create-runtime-capabilities.js';
import { createChatExecutionConsumer } from './create-execution-consumers.js';
import { createChannelComposition } from './create-channel-composition.js';
import { createMemoryCapabilities } from './create-memory-capabilities.js';
import {
  createKernelCapabilities,
  createTaskExecutionConsumers,
  createProductWorkExecutionAdmission,
} from './create-kernel-capabilities.js';
import { createInfrastructure } from './create-infrastructure.js';
import { createResourceCapabilities } from './create-resource-capabilities.js';
import {
  createTeamCapabilities,
  createTeamExecutionConsumers,
} from './create-team-capabilities.js';
import {
  createWorkCapabilities,
  createWorkExecutionFacts,
} from './create-work-capabilities.js';
import { createWorkOrganizationCapabilities } from './create-work-organization-capabilities.js';
import { createWorkers } from './create-workers.js';
import type { FileStore } from '../application/ports/file-store.js';
import type { RuntimeExecutionProvider } from '../application/ports/runtime-execution-provider.js';
import type { PostgresSessionRepository } from '../infrastructure/postgres/postgres-session-repository.js';
import { createRuntimeToolCatalog } from '../entrypoints/mcp/runtime-tool-composition.js';
import { createRuntimeOwner } from './create-runtime-owner.js';
import { createRunExecutionComposition } from './create-run-execution-composition.js';
import { createHostComposition } from './create-host-composition.js';

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
  readonly runtimeProvider?: RuntimeExecutionProvider;
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
  const directChatEnabled = directChatPlane !== 'absent';
  const productWorkEnabled =
    config.productWorkAvailability.surface === 'composed';
  const kernel = createKernelCapabilities({
    pool,
    config,
    definitionReadApi: resourceModule.definitionReadApi,
    agentResolutionApi: resourceModule.agentResolutionApi,
    workerResolutionApi: resourceModule.workerResolutionApi,
  });
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
  } = kernel;
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
  const runtimeCapabilities = createConfiguredRuntimeCapabilities(config);
  const workExecutionFacts = productWorkEnabled
    ? createWorkExecutionFacts(pool)
    : null;
  const { workModule, workChatWorker, conversationWorkLinks } =
    createWorkCapabilities({
      database: pool,
      definitions: resourceModule.definitionReadApi,
      definitionResolution: resourceModule.workDefinitionResolution,
      ...(productWorkEnabled && workExecutionFacts
        ? {
            execution: createProductWorkExecutionAdmission(invokeTask),
            executionFacts: workExecutionFacts,
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
  const workOrganizationModule =
    productWorkEnabled && workModule
      ? createWorkOrganizationCapabilities({
          database: pool,
          work: workModule,
          ...(directChatEnabled && conversations ? { conversations } : {}),
        })
      : undefined;
  const runtimeToolCatalog = createRuntimeToolCatalog({
    memory: memoryModule.contributeRuntime,
    collaboration: {
      contextResolver: teamToolContextResolver,
      kernel: collaboration,
    },
    logger,
    events,
    ...(workModule ? { work: workModule.contributeRuntime } : {}),
  });
  const runtimeOwner = createRuntimeOwner({
    database: pool,
    config,
    logger,
    toolCatalog: runtimeToolCatalog,
    ...(options.runtimeProvider
      ? { runtimeProvider: options.runtimeProvider }
      : {}),
  });
  const {
    runtimeProvider,
    runtimeSessions,
    ensureDesiredRuntimeSpec,
    executeRuntimeTurn: runtimeTurns,
    oneShotCompletion,
    runtimeMcpServer,
    chatRuntime,
  } = runtimeOwner;
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
  const channelComposition = createChannelComposition({
    config,
    repository: channelRepository,
    reviewSurface: reviewSurfaceRepository,
    submitSessionTurn,
    memory: memoryModule,
    oneShotCompletion,
    workerId,
    leaseMs: leaseDurationMs,
    logger,
  });
  const { cancelTask, getTask, getTaskTree } = createTaskExecutionConsumers({
    taskRepository,
    runRepository,
    executionRuns: runtimeOwner.cancelRuntimeRun,
    events,
  });
  const terminalActivationReconciler = options.deferTeamWakeReconcile
    ? undefined
    : collaborationActivationReconciler;
  const { teamDriver, executeTeamTask } = createTeamExecutionConsumers({
    module: teamModule,
    definitions: resourceModule.definitionReadApi,
    activationReconciler: terminalActivationReconciler,
    completionApprovalRequired: config.teamCompletionApprovalRequired,
  });
  const { executeRun, dispatcher } = createRunExecutionComposition({
    kernel: {
      runRepository,
      taskRepository,
      events,
      sessions,
    },
    team: {
      executions: collaborativeTeamExecutions,
      activationReconciler: collaborationActivationReconciler,
    },
    teamDriver,
    executeTeamTask,
    resources: resourceModule,
    runtime: {
      runtimeProvider,
      executeRuntimeTurn: runtimeTurns,
      runtimeSessions,
      ensureDesiredRuntimeSpec,
      chatRuntime,
    },
    memory: memoryModule,
    ...(channelComposition.memoryReviewSurface
      ? { memoryReviewSurface: channelComposition.memoryReviewSurface }
      : {}),
    ...(options.memoryReviewNotifier
      ? { memoryReviewNotifier: options.memoryReviewNotifier }
      : {}),
    ...(terminalActivationReconciler ? { terminalActivationReconciler } : {}),
    workerId,
    leaseDurationMs,
    concurrency: config.dispatcher?.concurrency ?? 4,
    logger,
  });
  const host = await createHostComposition({
    config,
    logger,
    kernel,
    team: teamModule,
    teamDriver,
    taskConsumers: { cancelTask, getTask, getTaskTree },
    memory: memoryModule,
    resources: resourceModule,
    ...(workModule ? { workModule } : {}),
    ...(workOrganizationModule ? { workOrganizationModule } : {}),
    channels: channelComposition,
    ...(chatCapabilities.chatWorker
      ? { chatWorker: chatCapabilities.chatWorker }
      : {}),
    ...(workChatWorker ? { workChatWorker } : {}),
    runtime: { runtimeProvider, runtimeMcpServer },
    dispatcher,
    pool,
    activationReconciler: collaborationActivationReconciler,
    ...(options.singleRunDebug ? { singleRunDebug: true } : {}),
  });

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
    app: host.app,
    controls: {
      dispatcher,
      sessions,
      memoryModule,
    } satisfies ApplicationControls,
    ...(singleRunDebug ? { singleRunDebug } : {}),
    close: host.close,
  };
}
