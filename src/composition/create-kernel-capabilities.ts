import type { Pool } from 'pg';

import { AdmitRootTask } from '../application/tasks/admit-root-task.js';
import { GetRun } from '../application/runs/get-run.js';
import { InvokeTask } from '../application/tasks/invoke-task.js';
import { SubmitRun } from '../application/runs/submit-run.js';
import { SubmitSessionTurn } from '../application/sessions/submit-session-turn.js';
import type { AgentResolutionApi } from '../application/ports/agent-resolution-api.js';
import type { WorkerResolutionApi } from '../application/ports/worker-registry.js';
import type { DefinitionReadApi } from '../application/ports/definition-read-api.js';
import { PostgresAdmissionRepository } from '../infrastructure/postgres/postgres-admission-repository.js';
import { PostgresChatDispatchRepository } from '../infrastructure/postgres/postgres-chat-dispatch-repository.js';
import { PostgresChannelRepository } from '../infrastructure/postgres/postgres-channel-repository.js';
import { PostgresConversationRepository } from '../infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { PostgresLarkReviewSurfaceRepository } from '../infrastructure/postgres/postgres-lark-review-surface-repository.js';
import { PostgresRunEventRepository } from '../infrastructure/postgres/postgres-run-event-repository.js';
import { PostgresRunRepository } from '../infrastructure/postgres/postgres-run-repository.js';
import { PostgresSessionRepository } from '../infrastructure/postgres/postgres-session-repository.js';
import { PostgresTaskRepository } from '../infrastructure/postgres/postgres-task-repository.js';
import type { AppConfig } from '../shared/config.js';
import { InvokeTaskExecutionAdmission } from '../application/ports/execution-admission.js';
import { CancelTask } from '../application/tasks/cancel-task.js';
import { GetTask } from '../application/tasks/get-task.js';
import { GetTaskTree } from '../application/tasks/get-task-tree.js';

export interface KernelCapabilities {
  readonly runRepository: PostgresRunRepository;
  readonly taskRepository: PostgresTaskRepository;
  readonly admissionRepository: PostgresAdmissionRepository;
  readonly sessions: PostgresSessionRepository;
  readonly conversations?: PostgresConversationRepository;
  readonly conversationWorkEntitlements?: PostgresConversationWorkEntitlementRepository;
  readonly chatDispatches?: PostgresChatDispatchRepository;
  readonly submitSessionTurn: SubmitSessionTurn;
  readonly channelRepository: PostgresChannelRepository;
  readonly reviewSurfaceRepository: PostgresLarkReviewSurfaceRepository;
  readonly events: PostgresRunEventRepository;
  readonly admitRootTask: AdmitRootTask;
  readonly submitRun: SubmitRun;
  readonly getRun: GetRun;
  readonly invokeTask: InvokeTask;
}

export interface CreateKernelCapabilitiesOptions {
  readonly pool: Pool;
  readonly config: Pick<
    AppConfig,
    'directChatPlane' | 'productWorkAvailability'
  >;
  readonly definitionReadApi: DefinitionReadApi;
  readonly agentResolutionApi: AgentResolutionApi;
  readonly workerResolutionApi: WorkerResolutionApi;
}

/** Creates the durable application kernel values consumed by the composition root. */
export function createKernelCapabilities(
  options: CreateKernelCapabilitiesOptions,
): KernelCapabilities {
  const runRepository = new PostgresRunRepository(options.pool);
  const taskRepository = new PostgresTaskRepository(options.pool);
  const admissionRepository = new PostgresAdmissionRepository(options.pool);
  const sessions = new PostgresSessionRepository(options.pool);
  const directChatEnabled = options.config.directChatPlane !== 'absent';
  const productWorkEnabled =
    options.config.productWorkAvailability.surface === 'composed';
  const conversations = directChatEnabled
    ? new PostgresConversationRepository(options.pool)
    : undefined;
  const conversationWorkEntitlements =
    directChatEnabled && productWorkEnabled
      ? new PostgresConversationWorkEntitlementRepository(options.pool)
      : undefined;
  const chatDispatches = directChatEnabled
    ? new PostgresChatDispatchRepository(options.pool)
    : undefined;
  const submitSessionTurn = new SubmitSessionTurn(sessions);
  const channelRepository = new PostgresChannelRepository(options.pool);
  const reviewSurfaceRepository = new PostgresLarkReviewSurfaceRepository(
    options.pool,
  );
  const events = new PostgresRunEventRepository(options.pool);
  const admitRootTask = new AdmitRootTask(
    taskRepository,
    runRepository,
    admissionRepository,
  );
  const submitRun = new SubmitRun(admitRootTask, runRepository);
  const getRun = new GetRun(runRepository);
  const invokeTask = new InvokeTask(
    admissionRepository,
    options.definitionReadApi,
    options.agentResolutionApi,
    options.workerResolutionApi,
  );

  return Object.freeze({
    runRepository,
    taskRepository,
    admissionRepository,
    sessions,
    ...(conversations ? { conversations } : {}),
    ...(conversationWorkEntitlements ? { conversationWorkEntitlements } : {}),
    ...(chatDispatches ? { chatDispatches } : {}),
    submitSessionTurn,
    channelRepository,
    reviewSurfaceRepository,
    events,
    admitRootTask,
    submitRun,
    getRun,
    invokeTask,
  });
}

export function createProductWorkExecutionAdmission(
  invokeTask: InvokeTask,
): InvokeTaskExecutionAdmission {
  return new InvokeTaskExecutionAdmission(invokeTask);
}

export function createTaskExecutionConsumers(input: {
  readonly taskRepository: PostgresTaskRepository;
  readonly runRepository: PostgresRunRepository;
  readonly events: PostgresRunEventRepository;
  readonly executionRuns: ConstructorParameters<typeof CancelTask>[2];
}): {
  readonly cancelTask: CancelTask;
  readonly getTask: GetTask;
  readonly getTaskTree: GetTaskTree;
} {
  return {
    cancelTask: new CancelTask(
      input.taskRepository,
      input.runRepository,
      input.executionRuns,
      input.events,
    ),
    getTask: new GetTask(input.taskRepository),
    getTaskTree: new GetTaskTree(input.taskRepository),
  };
}
