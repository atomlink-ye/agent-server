import { randomUUID } from 'node:crypto';

import { RuntimeReadinessProbe } from './application/health/readiness.js';
import { CreateMemoryProposal } from './application/memory/create-memory-proposal.js';
import { ListMemoryEntries } from './application/memory/list-memory-entries.js';
import { ListMemoryProposals } from './application/memory/list-memory-proposals.js';
import { ReviewMemoryProposal } from './application/memory/review-memory-proposal.js';
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
import { PostgresAgentRegistry } from './infrastructure/postgres/postgres-agent-registry.js';
import type { AppConfig } from './shared/config.js';
import type { Logger } from './shared/observability/logger.js';

export interface ServiceResources {
  readonly dispatcher: Pick<RunDispatcher, 'stop'>;
  readonly runtime: Pick<AgentRuntimePort, 'close'>;
  readonly pool: { end(): Promise<void> };
}

export async function closeServiceResources(
  resources: ServiceResources,
): Promise<void> {
  await resources.dispatcher.stop();
  await resources.runtime.close();
  await resources.pool.end();
}

export async function createService(config: AppConfig, logger: Logger) {
  const workerId = `agent-server:${process.pid}:${randomUUID()}`;
  const pool = createPostgresPool();
  await applyDurableKernelMigrations(pool);

  const runRepository = new PostgresRunRepository(pool);
  const taskRepository = new PostgresTaskRepository(pool);
  const admissionRepository = new PostgresAdmissionRepository(pool);
  const invokableRepository = new PostgresInvokableRepository(pool);
  const workspaceMemoryRepository = new PostgresWorkspaceMemoryRepository(pool);
  const agentRegistry = new PostgresAgentRegistry(pool);
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
  const admitRootTask = new AdmitRootTask(
    taskRepository,
    runRepository,
    admissionRepository,
  );
  const submitRun = new SubmitRun(admitRootTask, runRepository);
  const getRun = new GetRun(runRepository);
  const invokeTask = new InvokeTask(admissionRepository, invokableRepository);
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
  const listMemoryEntries = new ListMemoryEntries(workspaceMemoryRepository);
  const completeRun = new CompleteRun(runRepository, taskRepository);
  const executeTeamTask = new ExecuteTeamTask(
    taskRepository,
    runRepository,
    invokableRepository,
    runtime,
    completeRun,
  );
  const executeRun = new ExecuteRun(
    completeRun,
    taskRepository,
    invokableRepository,
    executeTeamTask,
    runtime,
    logger,
  );
  const dispatcher = new PostgresRunDispatcher(
    new ClaimNextRun(runRepository, {
      workerId,
      leaseDurationMs: Math.max(config.paseo.executionTimeoutMs * 2, 30_000),
    }),
    executeRun,
    logger,
  );
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
    listMemoryEntries,
    agentRegistry,
  });
  dispatcher.start();

  return {
    app,
    runtime,
    close: async () => {
      await closeServiceResources({ dispatcher, runtime, pool });
    },
  };
}
