import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';

import { RuntimeReadinessProbe } from '../../src/application/health/readiness.js';
import { ResolveAgentVersion } from '../../src/application/agents/resolve-agent-version.js';
import { CreateMemoryProposal } from '../../src/application/memory/create-memory-proposal.js';
import { ListMemoryEntries } from '../../src/application/memory/list-memory-entries.js';
import { ListMemoryProposals } from '../../src/application/memory/list-memory-proposals.js';
import { ReviewMemoryProposal } from '../../src/application/memory/review-memory-proposal.js';
import type { AgentRuntimePort } from '../../src/application/ports/agent-runtime.js';
import { ClaimNextRun } from '../../src/application/runs/claim-next-run.js';
import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { GetRun } from '../../src/application/runs/get-run.js';
import { SubmitRun } from '../../src/application/runs/submit-run.js';
import { AdmitRootTask } from '../../src/application/tasks/admit-root-task.js';
import { GetTask } from '../../src/application/tasks/get-task.js';
import { GetTaskTree } from '../../src/application/tasks/get-task-tree.js';
import { ExecuteTeamTask } from '../../src/application/tasks/execute-team-task.js';
import { InvokeTask } from '../../src/application/tasks/invoke-task.js';
import { createAgentDefinition } from '../../src/domain/invokables/agent-definition.js';
import {
  createDraftAgentVersion,
  publishAgentVersion,
} from '../../src/domain/invokables/agent-version.js';
import { createApp } from '../../src/entrypoints/api/app.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresWorkspaceMemoryRepository } from '../../src/infrastructure/postgres/postgres-workspace-memory-repository.js';
import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';
import { createLogger } from '../../src/shared/observability/logger.js';

export const primaryServiceAccountToken = 'token-enabled';
export const secondaryServiceAccountToken = 'token-other-owner';
export const disabledServiceAccountToken = 'token-disabled';
export const defaultPublishedAgentVersionId =
  '00000000-0000-4000-8000-0000000a0101';

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

export interface CreateTestAppOptions {
  readonly startDispatcher?: boolean;
}

export async function createTestApp(
  runtime: AgentRuntimePort,
  options: CreateTestAppOptions = {},
) {
  const workerId = `agent-server-test:${process.pid}:${randomUUID()}`;
  const database = new PGlite();
  await applyDurableKernelMigrations(database);
  const agentRegistry = new PostgresAgentRegistry(database);

  const runRepository = new PostgresRunRepository(database);
  const taskRepository = new PostgresTaskRepository(database);
  const admissionRepository = new PostgresAdmissionRepository(database);
  const invokableRepository = new PostgresInvokableRepository(database);
  const resolveAgentVersion = new ResolveAgentVersion(
    agentRegistry,
    invokableRepository,
  );
  const workspaceMemoryRepository = new PostgresWorkspaceMemoryRepository(
    database,
  );
  await seedDefaultPublishedAgent(invokableRepository);
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
    undefined,
    resolveAgentVersion,
  );
  if (options.startDispatcher ?? true) {
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
  }

  return createApp({
    config: testConfig,
    logger,
    readiness: new RuntimeReadinessProbe(runtime),
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
}

async function seedDefaultPublishedAgent(
  invokables: PostgresInvokableRepository,
): Promise<void> {
  const createdAt = () => new Date('2026-07-22T12:00:00.000Z');
  const publishedAt = () => new Date('2026-07-22T12:05:00.000Z');
  const definition = createAgentDefinition({
    id: '00000000-0000-4000-8000-0000000a0001',
    tenantId: 'tenant_alpha',
    workspaceId: 'workspace_main',
    principalType: 'service_account',
    principalId: 'svc_enabled',
    name: 'Default Task Agent',
    description: 'Seeded test invokable',
    now: createdAt,
  });
  const version = publishAgentVersion(
    createDraftAgentVersion({
      id: defaultPublishedAgentVersionId,
      definitionId: definition.id,
      tenantId: definition.tenantId,
      workspaceId: definition.workspaceId,
      principalType: definition.principalType,
      principalId: definition.principalId,
      name: 'Default Task Agent v1',
      description: 'Seeded test invokable',
      instructions: 'Do the task.',
      now: createdAt,
    }),
    publishedAt,
  );

  await invokables.saveAgentDefinition(definition);
  await invokables.saveAgentVersion(version);
}
