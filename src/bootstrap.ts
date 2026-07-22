import { randomUUID } from 'node:crypto';

import { RuntimeReadinessProbe } from './application/health/readiness.js';
import type { AgentRuntimePort } from './application/ports/agent-runtime.js';
import type { RunDispatcher } from './application/ports/run-dispatcher.js';
import { ClaimNextRun } from './application/runs/claim-next-run.js';
import { CompleteRun } from './application/runs/complete-run.js';
import { ExecuteRun } from './application/runs/execute-run.js';
import { GetRun } from './application/runs/get-run.js';
import { SubmitRun } from './application/runs/submit-run.js';
import { AdmitRootTask } from './application/tasks/admit-root-task.js';
import { PaseoRuntimeAdapter } from './adapters/paseo/paseo-runtime-adapter.js';
import { createApp } from './entrypoints/api/app.js';
import { PostgresAdmissionRepository } from './infrastructure/postgres/postgres-admission-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from './infrastructure/postgres/postgres.js';
import { PostgresRunDispatcher } from './infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresRunRepository } from './infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from './infrastructure/postgres/postgres-task-repository.js';
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
  const completeRun = new CompleteRun(runRepository);
  const executeRun = new ExecuteRun(completeRun, runtime, logger);
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
