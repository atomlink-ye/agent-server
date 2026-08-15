import { randomUUID } from 'node:crypto';

import type { ExecutionRuntimeService } from './application/runtime/execution-plane-runtime-facade.js';
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
import { createLegacyRuntimeToolsContributor } from './entrypoints/mcp/runtime-tool-contributors.js';
import { PostgresTeamExecutionRepository } from './infrastructure/postgres/postgres-collaborative-team-repository.js';
import { PostgresTeamMessageRepository } from './infrastructure/postgres/postgres-team-message-repository.js';
import { SyntheticMarketAdapter } from './adapters/demo-market/synthetic-market-adapter.js';
import { TeamToolContextResolver } from './application/teams/team-tool-context.js';
import { TeamCommandService } from './application/teams/team-command-service.js';
import { TeamPolicyEvaluator } from './application/teams/team-policy-evaluator.js';
import { TeamDriver } from './application/teams/team-driver.js';
import { TeamWakeReconciler } from './application/teams/team-wake-reconciler.js';
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

export interface ServiceResources {
  readonly dispatcher: Pick<RunDispatcher, 'stop'>;
  readonly larkWorker?: Pick<LarkIngressWorker, 'stop'>;
  readonly larkOutboxWorker?: Pick<LarkOutboxWorker, 'stop'>;
  readonly larkReceiver?: Pick<
    ReturnType<typeof createLarkWebsocketReceiver>,
    'stop'
  >;
  readonly runtime: Pick<ExecutionRuntimeService, 'close'>;
  readonly runtimeMcpServer?: { stop(): Promise<void> };
  readonly pool: { end(): Promise<void> };
}

type StartableServiceResources = ServiceResources & {
  readonly dispatcher: Pick<RunDispatcher, 'start' | 'stop'>;
  readonly larkWorker?: Pick<LarkIngressWorker, 'start' | 'stop'>;
  readonly larkOutboxWorker?: Pick<LarkOutboxWorker, 'start' | 'stop'>;
  readonly larkReceiver?: Pick<
    ReturnType<typeof createLarkWebsocketReceiver>,
    'start' | 'stop'
  >;
};

export async function closeServiceResources(
  resources: ServiceResources,
): Promise<void> {
  const failures: Error[] = [];
  await cleanup(
    'lark receiver',
    resources.larkReceiver ? () => resources.larkReceiver!.stop() : undefined,
    failures,
  );
  await cleanup(
    'lark worker',
    resources.larkWorker ? () => resources.larkWorker!.stop() : undefined,
    failures,
  );
  await cleanup(
    'lark outbox worker',
    resources.larkOutboxWorker
      ? () => resources.larkOutboxWorker!.stop()
      : undefined,
    failures,
  );
  await cleanup('dispatcher', () => resources.dispatcher.stop(), failures);
  await cleanup('runtime', () => resources.runtime.close(), failures);
  await cleanup(
    'runtime MCP server',
    resources.runtimeMcpServer
      ? () => resources.runtimeMcpServer!.stop()
      : undefined,
    failures,
  );
  await cleanup('pool', () => resources.pool.end(), failures);
  throwFailures(failures, 'service shutdown failed');
}

export async function startServiceResources(
  resources: StartableServiceResources,
): Promise<void> {
  try {
    resources.dispatcher.start();
    await resources.larkReceiver?.start();
    resources.larkWorker?.start();
    resources.larkOutboxWorker?.start();
  } catch (error: unknown) {
    const startupFailure = safeLifecycleError('service startup', error);
    try {
      await closeServiceResources(resources);
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [startupFailure, cleanupError],
        'service startup failed',
      );
    }
    throw startupFailure;
  }
}

async function cleanup(
  label: string,
  operation: (() => Promise<void>) | undefined,
  failures: Error[],
): Promise<void> {
  if (!operation) return;
  try {
    await operation();
  } catch (error: unknown) {
    failures.push(safeLifecycleError(label, error));
  }
}

function throwFailures(failures: readonly Error[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}

function safeLifecycleError(label: string, error: unknown): Error {
  const safe = new Error(`${label} failed`);
  safe.name = 'ServiceLifecycleError';
  return safe;
}

function turnLeaseDurationMs(executionTimeoutMs: number): number {
  return Math.max(executionTimeoutMs * 2 + 300_000, 30_000);
}

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
  const collaborativeTeamExecutions = new PostgresTeamExecutionRepository(pool);
  const teamMessages = new PostgresTeamMessageRepository(pool);
  const submitSessionTurn = new SubmitSessionTurn(sessions);
  const channelRepository = new PostgresChannelRepository(pool);
  const reviewSurfaceRepository = new PostgresLarkReviewSurfaceRepository(pool);
  const events = new PostgresRunEventRepository(pool);
  const teamPolicyEvaluator = new TeamPolicyEvaluator();
  const teamToolContextResolver = new TeamToolContextResolver(
    collaborativeTeamExecutions,
    taskRepository,
    runRepository,
    teamPolicyEvaluator,
  );
  const teamWakeReconciler = new TeamWakeReconciler(
    teamMessages,
    collaborativeTeamExecutions,
    taskRepository,
    admissionRepository,
    undefined,
    logger,
  );
  const teamCommandService = new TeamCommandService(
    collaborativeTeamExecutions,
    events,
    teamMessages,
    teamWakeReconciler,
  );
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
  const workModule = createWorkModule({
    database: pool,
    definitions: resourceModule.definitionReadApi,
    execution: new InvokeTaskExecutionAdmission(invokeTask),
    executionFacts: new PostgresExecutionFactQuery(pool),
  });
  const runtimeModule = createRuntimeModule({
    database: pool,
    config,
    logger,
    toolContributors: [
      workModule.contributeRuntime,
      memoryModule.contributeRuntime,
      createLegacyRuntimeToolsContributor({
        teamTools: {
          contextResolver: teamToolContextResolver,
          commands: teamCommandService,
        },
        market: new SyntheticMarketAdapter(),
        logger,
      }),
    ],
    ...(options.debugRuntime ? { debugRuntime: options.debugRuntime } : {}),
  });
  const {
    executionRuntime,
    executionRuns,
    sessions: runtimeSessions,
    extensions: runtimeExtensionBinder,
    mcpHost: runtimeMcpServer,
  } = runtimeModule;
  const synthesizeMemoryDocument = new SynthesizeMemoryDocument(executionRuntime);
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
  const terminalWakeReconciler = options.deferTeamWakeReconcile
    ? {
        reconcileForRootTask: async () => 0,
      }
    : teamWakeReconciler;
  const teamDriver = new TeamDriver(
    collaborativeTeamExecutions,
    taskRepository,
    runRepository,
    admissionRepository,
    teamMessages,
    terminalWakeReconciler,
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
    terminalWakeReconciler,
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
          await teamWakeReconciler.reconcileQueuedWakeRoots();
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
  const readiness = runtimeModule.readiness;
  const app = createApp({
    config,
    logger,
    readiness,
    executionRuntime,
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
    submitSessionTurn,
    events,
    cancelTask,
    workModule,
    memoryModule,
    resourceModule,
  });
  if (!options.singleRunDebug) {
    await teamWakeReconciler.reconcileQueuedWakeRoots();
    await startServiceResources({
      dispatcher,
      ...(larkWorker ? { larkWorker } : {}),
      ...(larkOutboxWorker ? { larkOutboxWorker } : {}),
      ...(larkReceiver ? { larkReceiver } : {}),
      runtime: executionRuntime,
      runtimeMcpServer,
      pool,
    });
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
            new TeamWakeReconciler(
              new PostgresTeamMessageRepository(pool),
              new PostgresTeamExecutionRepository(pool),
              new PostgresTaskRepository(pool),
              new PostgresAdmissionRepository(pool),
              undefined,
              logger,
            ).reconcileQueuedWakeRoots(),
          startDispatcher: () => dispatcher.start(),
          stopDispatcher: () => dispatcher.stop(),
        }
      : undefined;

  return {
    app,
    runtime: executionRuntime,
    ...(singleRunDebug ? { singleRunDebug } : {}),
    close: async () => {
      await closeServiceResources({
        dispatcher,
        ...(larkWorker ? { larkWorker } : {}),
        ...(larkOutboxWorker ? { larkOutboxWorker } : {}),
        ...(larkReceiver ? { larkReceiver } : {}),
        runtime: executionRuntime,
        runtimeMcpServer,
        pool,
      });
    },
  };
}
import { createWorkModule } from './modules/work/work-module.js';
