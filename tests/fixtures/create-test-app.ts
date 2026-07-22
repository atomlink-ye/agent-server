import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';

import { RuntimeReadinessProbe } from '../../src/application/health/readiness.js';
import type { AgentRuntimePort } from '../../src/application/ports/agent-runtime.js';
import { ClaimNextRun } from '../../src/application/runs/claim-next-run.js';
import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { GetRun } from '../../src/application/runs/get-run.js';
import { SubmitRun } from '../../src/application/runs/submit-run.js';
import { AdmitRootTask } from '../../src/application/tasks/admit-root-task.js';
import { createApp } from '../../src/entrypoints/api/app.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { createLogger } from '../../src/shared/observability/logger.js';

export const primaryServiceAccountToken = 'token-enabled';
export const secondaryServiceAccountToken = 'token-other-owner';
export const disabledServiceAccountToken = 'token-disabled';

export const testConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3_000,
  logLevel: 'error',
  serviceName: 'agent-server-test',
  serviceAccounts: [
    {
      serviceAccountId: 'svc_enabled',
      token: primaryServiceAccountToken,
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      policyVersion: 'policy-2026-07-22',
      disabled: false,
    },
    {
      serviceAccountId: 'svc_other_owner',
      token: secondaryServiceAccountToken,
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      policyVersion: 'policy-2026-07-22',
      disabled: false,
    },
    {
      serviceAccountId: 'svc_disabled',
      token: disabledServiceAccountToken,
      tenantId: 'tenant_alpha',
      workspaceId: 'workspace_main',
      policyVersion: 'policy-2026-07-22',
      disabled: true,
    },
  ],
  paseo: {
    wsUrl: 'ws://127.0.0.1:6767/ws',
    agentCwd: '/tmp/agent-server-test',
    workspaceTitle: 'Agent Server Test',
    connectTimeoutMs: 1_000,
    executionTimeoutMs: 1_000,
  },
} as const;

export async function createTestApp(runtime: AgentRuntimePort) {
  const workerId = `agent-server-test:${process.pid}:${randomUUID()}`;
  const database = new PGlite();
  await applyDurableKernelMigrations(database);

  const runRepository = new PostgresRunRepository(database);
  const taskRepository = new PostgresTaskRepository(database);
  const admissionRepository = new PostgresAdmissionRepository(database);
  const logger = createLogger({
    service: testConfig.serviceName,
    minimumLevel: 'error',
    write: () => undefined,
  });
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
      leaseDurationMs: 30_000,
    }),
    executeRun,
    logger,
    { pollIntervalMs: 1 },
  );
  dispatcher.start();

  return createApp({
    config: testConfig,
    logger,
    readiness: new RuntimeReadinessProbe(runtime),
    runtime,
    submitRun,
    getRun,
  });
}
