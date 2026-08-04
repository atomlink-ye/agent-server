import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { RuntimeReadinessProbe } from './application/health/readiness.js';
import { ResolveAgentVersion } from './application/agents/resolve-agent-version.js';
import { CreateMemoryProposal } from './application/memory/create-memory-proposal.js';
import {
  AcceptLearningProposal,
  CreateLearningProposal,
  GetLearningProposal,
  ListLearningProposals,
  RejectLearningProposal,
} from './application/learning/learning-proposals.js';
import { ListMemoryEntries } from './application/memory/list-memory-entries.js';
import { ListMemoryProposals } from './application/memory/list-memory-proposals.js';
import { ReviewMemoryProposal } from './application/memory/review-memory-proposal.js';
import { ManagedMemory } from './application/memory/managed-memory.js';
import type { AgentRuntimePort } from './application/ports/agent-runtime.js';
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
import { AdvanceTeamExecution } from './application/tasks/advance-team-execution.js';
import { InvokeTask } from './application/tasks/invoke-task.js';
import { PaseoRuntimeAdapter } from './adapters/paseo/paseo-runtime-adapter.js';
import { createApp } from './entrypoints/api/app.js';
import { PostgresAdmissionRepository } from './infrastructure/postgres/postgres-admission-repository.js';
import { PostgresInvokableRepository } from './infrastructure/postgres/postgres-invokable-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from './infrastructure/postgres/postgres.js';
import { PostgresRunDispatcher } from './infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresRunRepository } from './infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from './infrastructure/postgres/postgres-task-repository.js';
import { PostgresWorkspaceMemoryRepository } from './infrastructure/postgres/postgres-workspace-memory-repository.js';
import { PostgresLearningProposalRepository } from './infrastructure/postgres/postgres-learning-proposal-repository.js';
import { PostgresAgentRegistry } from './infrastructure/postgres/postgres-agent-registry.js';
import { PostgresSessionRepository } from './infrastructure/postgres/postgres-session-repository.js';
import { PostgresEnvironmentRegistry } from './infrastructure/postgres/postgres-environment-registry.js';
import { PostgresRunEventRepository } from './infrastructure/postgres/postgres-run-event-repository.js';
import { CancelTask } from './application/tasks/cancel-task.js';
import type { AppConfig, LarkCanaryEnabledConfig } from './shared/config.js';
import type { Logger } from './shared/observability/logger.js';
import { LocalFileStore } from './infrastructure/files/local-file-store.js';
import { SubmitSessionTurn } from './application/sessions/submit-session-turn.js';
import { ResolveLarkBinding } from './application/channels/resolve-lark-binding.js';
import { ProcessChannelIngress } from './application/channels/process-channel-ingress.js';
import { LarkIngressWorker } from './entrypoints/lark/worker.js';
import { LarkOutboxWorker } from './entrypoints/lark/outbox-worker.js';
import { createLarkWebsocketReceiver } from './adapters/lark/lark-websocket-receiver.js';
import { createLarkDeliveryAdapter } from './adapters/lark/lark-delivery-adapter.js';
import { PostgresChannelRepository } from './infrastructure/postgres/postgres-channel-repository.js';
import { PublishMemoryReviewSurface } from './application/channels/publish-memory-review-surface.js';
import { SynthesizeMemoryDocument } from './application/channels/synthesize-memory-document.js';
import { createLarkMemoryDocumentAdapter } from './adapters/lark/lark-memory-document.js';
import { PostgresLarkReviewSurfaceRepository } from './infrastructure/postgres/postgres-lark-review-surface-repository.js';
import { createMemoryReviewActionTokenDeriver } from './application/channels/memory-review-action-token.js';
import { DeliverChannelOutbox } from './application/channels/deliver-channel-outbox.js';
import { ApplyMemoryReviewCommand } from './application/channels/apply-memory-review-command.js';
import { ProcessLarkIngress } from './application/channels/process-lark-ingress.js';
import { ApplyMemoryReviewControl } from './application/channels/apply-memory-review-control.js';
import { AcceptMemoryFromBoundDocument } from './application/channels/accept-memory-from-bound-document.js';
import {
  CreateMemory,
  CreateMemoryStore,
  GetMemory,
  GetMemoryStore,
  ListMemories,
  ListMemoryStores,
  UpdateMemory,
} from './application/memory-api/memory-api.js';
import { PostgresMemoryApiRepository } from './infrastructure/postgres/postgres-memory-api-repository.js';
import { RuntimeMcpServer } from './infrastructure/extensions/runtime-mcp-server.js';
import { LocalRuntimeExtensionBinder } from './infrastructure/extensions/local-runtime-extension-binder.js';
import { PostgresRuntimeSessionRepository } from './infrastructure/postgres/postgres-runtime-session-repository.js';
import { PostgresDagTeamExecutionRepository } from './infrastructure/postgres/postgres-team-execution-repository.js';
import { PostgresTeamExecutionRepository } from './infrastructure/postgres/postgres-collaborative-team-repository.js';
import { LocalSkillCatalog } from './infrastructure/filesystem/local-skill-catalog.js';
import { SyntheticMarketAdapter } from './adapters/demo-market/synthetic-market-adapter.js';
import { CollaborativeTeamExecutor } from './application/teams/collaborative-team-executor.js';
import { TeamPhaseCoordinator } from './application/teams/team-phase-coordinator.js';
import { TeamToolHandler } from './application/teams/team-tools.js';
import { TeamToolContextResolver } from './application/teams/team-tool-context.js';
import { TeamCommandService } from './application/teams/team-command-service.js';
import { TeamPolicyEvaluator } from './application/teams/team-policy-evaluator.js';
import { TeamDriver } from './application/teams/team-driver.js';
import { registerSkill } from './application/extensions/skill-registry.js';
import {
  AGENT_SERVER_MEMORY_API_SKILL_REF,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
} from './application/agents/built-in-skills.js';

export interface ServiceResources {
  readonly dispatcher: Pick<RunDispatcher, 'stop'>;
  readonly larkWorker?: Pick<LarkIngressWorker, 'stop'>;
  readonly larkOutboxWorker?: Pick<LarkOutboxWorker, 'stop'>;
  readonly larkReceiver?: Pick<
    ReturnType<typeof createLarkWebsocketReceiver>,
    'stop'
  >;
  readonly runtime: Pick<AgentRuntimePort, 'close'>;
  readonly runtimeMcpServer?: Pick<RuntimeMcpServer, 'stop'>;
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
}

export interface CreateServiceOptions {
  /** Debug-only seam for retained, manually stepped fixtures. */
  readonly singleRunDebug?: boolean;
}

export async function createService(
  config: AppConfig,
  logger: Logger,
  options: CreateServiceOptions = {},
) {
  const workerId = `agent-server:${process.pid}:${randomUUID()}`;
  await registerSkill({
    registryRoot: config.skillRegistryRoot,
    ref: AGENT_SERVER_MEMORY_API_SKILL_REF,
    name: AGENT_SERVER_MEMORY_API_SKILL_REF,
    sourceRoot: fileURLToPath(
      new URL('../skills/agent-server-memory-api', import.meta.url),
    ),
    requiredToolRefs: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
  });
  const skillCatalog = new LocalSkillCatalog(config.skillRegistryRoot);
  const pool = createPostgresPool();
  await applyDurableKernelMigrations(pool);

  const runRepository = new PostgresRunRepository(pool);
  const taskRepository = new PostgresTaskRepository(pool);
  const admissionRepository = new PostgresAdmissionRepository(pool);
  const invokableRepository = new PostgresInvokableRepository(pool);
  const workspaceMemoryRepository = new PostgresWorkspaceMemoryRepository(pool);
  const learningProposalRepository = new PostgresLearningProposalRepository(
    pool,
  );
  const createLearningProposal = new CreateLearningProposal(
    learningProposalRepository,
  );
  const listLearningProposals = new ListLearningProposals(
    learningProposalRepository,
  );
  const getLearningProposal = new GetLearningProposal(
    learningProposalRepository,
  );
  const acceptLearningProposal = new AcceptLearningProposal(
    learningProposalRepository,
  );
  const rejectLearningProposal = new RejectLearningProposal(
    learningProposalRepository,
  );
  const memoryApiRepository = new PostgresMemoryApiRepository(pool);
  const createMemoryStore = new CreateMemoryStore(memoryApiRepository);
  const listMemoryStores = new ListMemoryStores(memoryApiRepository);
  const getMemoryStore = new GetMemoryStore(memoryApiRepository);
  const createMemory = new CreateMemory(memoryApiRepository);
  const listMemories = new ListMemories(memoryApiRepository);
  const getMemory = new GetMemory(memoryApiRepository);
  const updateMemory = new UpdateMemory(memoryApiRepository);
  const managedMemory = new ManagedMemory(
    pool,
    new LocalFileStore(`${config.paseo.agentCwd}/memory-store`),
  );
  const agentRegistry = new PostgresAgentRegistry(pool);
  const sessions = new PostgresSessionRepository(pool);
  const runtimeSessions = new PostgresRuntimeSessionRepository(pool);
  const teamExecutions = new PostgresDagTeamExecutionRepository(pool);
  const collaborativeTeamExecutions = new PostgresTeamExecutionRepository(pool);
  const environmentRegistry = new PostgresEnvironmentRegistry(pool);
  const submitSessionTurn = new SubmitSessionTurn(sessions);
  const channelRepository = new PostgresChannelRepository(pool);
  const reviewSurfaceRepository = new PostgresLarkReviewSurfaceRepository(pool);
  const reviewTokenDeriver = config.larkCanary?.enabled
    ? createMemoryReviewActionTokenDeriver(config.larkCanary.appSecret)
    : undefined;
  const memoryDocument = config.larkCanary?.enabled
    ? createLarkMemoryDocumentAdapter(config.larkCanary)
    : undefined;
  const memoryReviewSurface = config.larkCanary?.enabled
    ? new PublishMemoryReviewSurface(
        workspaceMemoryRepository,
        channelRepository,
        channelRepository,
        config.larkCanary.connectionKey,
        reviewSurfaceRepository,
        reviewTokenDeriver,
        memoryDocument,
        config.larkCanary.allowedOpenId,
      )
    : undefined;
  const events = new PostgresRunEventRepository(pool);
  const teamPolicyEvaluator = new TeamPolicyEvaluator();
  const teamToolHandler = new TeamToolHandler(
    collaborativeTeamExecutions,
    runRepository,
    taskRepository,
    events,
  );
  const teamToolContextResolver = new TeamToolContextResolver(
    collaborativeTeamExecutions,
    taskRepository,
    runRepository,
    teamPolicyEvaluator,
  );
  const teamCommandService = new TeamCommandService(
    collaborativeTeamExecutions,
    events,
  );
  const runtimeMcpServer = new RuntimeMcpServer(
    memoryApiRepository,
    undefined,
    {
      handler: teamToolHandler,
      contextResolver: teamToolContextResolver,
      commands: teamCommandService,
    },
    createLearningProposal,
    new SyntheticMarketAdapter(),
    logger,
  );
  const runtimeExtensionBinder = new LocalRuntimeExtensionBinder(
    config.paseo.agentCwd,
    config.skillRegistryRoot,
    runtimeMcpServer,
  );
  const resolveAgentVersion = new ResolveAgentVersion(
    agentRegistry,
    invokableRepository,
    skillCatalog,
  );
  const runtime = new PaseoRuntimeAdapter(
    {
      wsUrl: config.paseo.wsUrl,
      cwd: config.paseo.agentCwd,
      workspaceTitle: config.paseo.workspaceTitle,
      ...(config.paseo.model ? { requestedModel: config.paseo.model } : {}),
      connectTimeoutMs: config.paseo.connectTimeoutMs,
      executionTimeoutMs: config.paseo.executionTimeoutMs,
    },
    logger,
  );
  const synthesizeMemoryDocument = new SynthesizeMemoryDocument(runtime);
  const cancelTask = new CancelTask(
    taskRepository,
    runRepository,
    runtime,
    events,
  );
  const admitRootTask = new AdmitRootTask(
    taskRepository,
    runRepository,
    admissionRepository,
  );
  const submitRun = new SubmitRun(admitRootTask, runRepository);
  const getRun = new GetRun(runRepository);
  const invokeTask = new InvokeTask(
    admissionRepository,
    invokableRepository,
    resolveAgentVersion,
  );
  const getTask = new GetTask(taskRepository);
  const getTaskTree = new GetTaskTree(taskRepository);
  const createMemoryProposal = new CreateMemoryProposal(
    workspaceMemoryRepository,
    taskRepository,
  );
  const listMemoryProposals = new ListMemoryProposals(
    workspaceMemoryRepository,
  );
  const reviewMemoryProposal = new ReviewMemoryProposal(
    workspaceMemoryRepository,
  );
  const acceptMemoryFromDocument = new AcceptMemoryFromBoundDocument(
    runtime,
    events,
    reviewMemoryProposal,
    managedMemory,
    process.env.LARK_CLI_PROFILE ?? 'agent-test',
  );
  const listMemoryEntries = new ListMemoryEntries(workspaceMemoryRepository);
  const collaborativeExecutor = new CollaborativeTeamExecutor(
    collaborativeTeamExecutions,
  );
  const teamDriver = new TeamDriver(
    collaborativeTeamExecutions,
    taskRepository,
    runRepository,
    admissionRepository,
  );
  const teamPhaseCoordinator = new TeamPhaseCoordinator(
    collaborativeTeamExecutions,
    collaborativeExecutor,
    taskRepository,
    runRepository,
    admissionRepository,
    teamDriver,
  );
  const advanceTeamExecution = new AdvanceTeamExecution(
    teamExecutions,
    taskRepository,
    runRepository,
    invokableRepository,
    admissionRepository,
  );
  const completeRun = new CompleteRun(
    runRepository,
    taskRepository,
    events,
    sessions,
    memoryReviewSurface
      ? { notifySucceeded: (input) => memoryReviewSurface.execute(input) }
      : undefined,
    advanceTeamExecution,
    teamPhaseCoordinator,
  );
  const executeTeamTask = new ExecuteTeamTask(
    taskRepository,
    runRepository,
    invokableRepository,
    runtime,
    completeRun,
    undefined,
    admissionRepository,
    teamExecutions,
    collaborativeExecutor,
    collaborativeTeamExecutions,
    runtimeSessions,
    teamDriver,
  );
  const executeRun = new ExecuteRun(
    completeRun,
    taskRepository,
    invokableRepository,
    executeTeamTask,
    runtime,
    logger,
    undefined,
    resolveAgentVersion,
    events,
    new LocalFileStore(`${config.paseo.agentCwd}/memory-store`),
    createMemoryProposal,
    runtimeExtensionBinder,
    runtimeSessions,
    sessions,
    environmentRegistry,
    config.paseo.runtimeCellRoot,
    teamExecutions,
    collaborativeTeamExecutions,
    runRepository,
  );
  const dispatcher = new PostgresRunDispatcher(
    new ClaimNextRun(runRepository, {
      workerId,
      leaseDurationMs: Math.max(config.paseo.executionTimeoutMs * 2, 30_000),
    }),
    executeRun,
    logger,
    { concurrency: 2 },
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
        reviewMemoryProposal,
        managedMemory,
        larkConfig,
      ),
      new ApplyMemoryReviewControl(
        channelRepository,
        reviewSurfaceRepository!,
        reviewMemoryProposal,
        managedMemory,
        larkConfig,
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
        leaseMs: Math.max(config.paseo.executionTimeoutMs * 2, 30_000),
      },
    );
    larkOutboxWorker = createLarkOutboxWorker(
      channelRepository,
      new DeliverChannelOutbox(
        createLarkDeliveryAdapter(larkConfig),
        channelRepository,
        {
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
        leaseMs: Math.max(config.paseo.executionTimeoutMs * 2, 30_000),
      },
    );
    larkReceiver = createLarkWebsocketReceiver({
      config: larkConfig,
      repository: channelRepository,
    });
  }
  const readiness = new RuntimeReadinessProbe(runtime);
  const app = createApp({
    config,
    logger,
    readiness,
    runtime,
    submitRun,
    getRun,
    invokeTask,
    getTask,
    getTaskTree,
    createMemoryProposal,
    listMemoryProposals,
    reviewMemoryProposal,
    listLearningProposals,
    getLearningProposal,
    acceptLearningProposal,
    rejectLearningProposal,
    listMemoryEntries,
    managedMemory,
    agentRegistry,
    invokableRepository,
    teamExecutions: collaborativeTeamExecutions,
    tasks: taskRepository,
    environmentRegistry,
    sessions,
    submitSessionTurn,
    events,
    cancelTask,
    memoryApi: {
      createMemoryStore,
      listMemoryStores,
      getMemoryStore,
      createMemory,
      listMemories,
      getMemory,
      updateMemory,
    },
  });
  if (!options.singleRunDebug) {
    await startServiceResources({
      dispatcher,
      ...(larkWorker ? { larkWorker } : {}),
      ...(larkOutboxWorker ? { larkOutboxWorker } : {}),
      ...(larkReceiver ? { larkReceiver } : {}),
      runtime,
      runtimeMcpServer,
      pool,
    });
  }

  const singleRunDebug: SingleRunDebugControl | undefined = options.singleRunDebug
    ? {
        claimAndExecute: async (runId) => {
          const claimedAt = new Date();
          const claim = await runRepository.claimQueuedById({
            runId,
            workerId,
            activationId: randomUUID(),
            claimedAt: claimedAt.toISOString(),
            leaseExpiresAt: new Date(
              claimedAt.getTime() +
                Math.max(config.paseo.executionTimeoutMs * 2, 30_000),
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
      }
    : undefined;

  return {
    app,
    runtime,
    ...(singleRunDebug ? { singleRunDebug } : {}),
    close: async () => {
      await closeServiceResources({
        dispatcher,
        ...(larkWorker ? { larkWorker } : {}),
        ...(larkOutboxWorker ? { larkOutboxWorker } : {}),
        ...(larkReceiver ? { larkReceiver } : {}),
        runtime,
        runtimeMcpServer,
        pool,
      });
    },
  };
}
