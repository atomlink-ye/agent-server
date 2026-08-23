import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { RuntimeReadinessProbe } from '../../src/application/health/readiness.js';
import { createConfiguredRuntimeCapabilities } from '../../src/composition/create-runtime-capabilities.js';
import { createMemoryModule } from '../../src/modules/memory/memory-module.js';
import { createResourceModule } from '../../src/composition/create-resource-capabilities.js';
import { createWorkModule } from '../../src/modules/work/work-module.js';
import { CreateMemoryProposal } from '../../src/application/memory/create-memory-proposal.js';
import { ListMemoryEntries } from '../../src/application/memory/list-memory-entries.js';
import { ListMemoryProposals } from '../../src/application/memory/list-memory-proposals.js';
import { ReviewMemoryProposal } from '../../src/application/memory/review-memory-proposal.js';
import { ManagedMemory } from '../../src/application/memory/managed-memory.js';
import type { ExecutionRuntimeService } from '../../src/application/ports/execution-runtime.js';
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
import { InvokeTaskExecutionAdmission } from '../../src/application/ports/execution-admission.js';
import { CancelTask } from '../../src/application/tasks/cancel-task.js';
import { createHttpApp } from '../../src/entrypoints/api/app.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresExecutionFactQuery } from '../../src/infrastructure/postgres/postgres-execution-fact-query.js';
import { PostgresWorkspaceMemoryRepository } from '../../src/infrastructure/postgres/postgres-workspace-memory-repository.js';
import {
  canonicalAgentResolver,
  seedCanonicalPublishedAgent,
} from './canonical-agent.js';
import { PostgresSessionRepository } from '../../src/infrastructure/postgres/postgres-session-repository.js';
import { PostgresRunEventRepository } from '../../src/infrastructure/postgres/postgres-run-event-repository.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import type { PublishMemoryReviewSurface } from '../../src/application/channels/publish-memory-review-surface.js';

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
  directChatPlane: 'execution_runtime',
  productWorkPlane: 'execution_runtime',
  teamCompletionApprovalRequired: false,
  skillRegistryRoot: '/tmp/agent-server-test/skill-registry',
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
    provider: 'opencode',
    workspaceTitle: 'Agent Server Test',
    connectTimeoutMs: 1_000,
    connectTimeoutSource: 'default',
    executionTimeoutMs: 1_000,
    executionTimeoutSource: 'default',
    sessionRpcTimeoutMs: 2_000,
    sessionRpcTimeoutSource: 'default',
  },
} as const;

export interface CreateTestAppOptions {
  readonly startDispatcher?: boolean;
  readonly seedManagedAgent?: boolean;
  readonly seedPublishedEnvironment?: boolean;
  readonly workspaceId?: string;
  readonly projectionFailures?: number;
  readonly dispatcherControl?: { dispatcher?: PostgresRunDispatcher };
  readonly databaseControl?: { database?: TestDatabase };
  readonly database?: TestDatabase;
  readonly publishedAgentVersionId?: string;
  readonly sessionRepositoryControl?: {
    repository?: PostgresSessionRepository;
  };
  readonly workspaceMemoryFixtureControl?: {
    seedAcceptedEntry?: (
      workspaceId: string,
      content: string,
    ) => Promise<{
      proposalId: string;
      entryId: string;
      snapshotId: string;
      contentHash: string;
    }>;
  };
  readonly memoryReviewControl?: {
    review?: ReviewMemoryProposal;
    managedMemory?: ManagedMemory;
  };
  readonly memoryReviewNotifier?: Pick<PublishMemoryReviewSurface, 'execute'>;
}

export type TestDatabase = {
  query<Row = Record<string, unknown>>(
    ...args: readonly unknown[]
  ): Promise<{ rows: readonly Row[]; [key: string]: unknown }>;
  connect?(): Promise<any>;
  close?(): Promise<void>;
  end?(): Promise<void>;
};

export async function createTestApp(
  runtime: ExecutionRuntimeService,
  options: CreateTestAppOptions = {},
) {
  const workerId = `agent-server-test:${process.pid}:${randomUUID()}`;
  const database = (options.database ?? new PGlite()) as TestDatabase;
  await applyDurableKernelMigrations(database as any);
  if (options.seedPublishedEnvironment) {
    const now = new Date().toISOString();
    const definitionId = '00000000-0000-4000-8000-0000000e0101';
    const versionId = '00000000-0000-4000-8000-0000000e0102';
    await (database as any).query(
      `INSERT INTO environment_definitions(id,tenant_id,principal_type,principal_id,normalized_name,display_name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
      [
        definitionId,
        'tenant_alpha',
        'service_account',
        'svc_enabled',
        'test-environment',
        'Test Environment',
        now,
      ],
    );
    await (database as any).query(
      `INSERT INTO environment_versions(id,definition_id,tenant_id,principal_type,principal_id,status,display_name,canonical_package,fingerprint,created_at,updated_at,published_at) VALUES($1,$2,$3,$4,$5,'published',$6,$7,$8,$9,$9,$9)`,
      [
        versionId,
        definitionId,
        'tenant_alpha',
        'service_account',
        'svc_enabled',
        'Test Environment',
        {
          apiVersion: 'agent-server/v1alpha1',
          kind: 'ManagedEnvironment',
          metadata: { name: 'test-environment' },
          spec: {
            adapter: 'paseo',
            provider: 'opencode',
            modelPolicyRef: 'free-only',
            runtimeCellPolicy: 'per_runtime_session',
          },
        },
        'sha256:test-environment-fixture',
        now,
      ],
    );
  }
  if (options.databaseControl) options.databaseControl.database = database;
  const effectiveConfig = options.workspaceId
    ? {
        ...testConfig,
        serviceAccounts: testConfig.serviceAccounts.map((account) => ({
          ...account,
          workspaceId:
            account.serviceAccountId === 'svc_enabled'
              ? (options.workspaceId ?? account.workspaceId)
              : `foreign-${options.workspaceId ?? account.workspaceId}`,
        })),
      }
    : testConfig;
  if (options.workspaceId) {
    const now = new Date().toISOString();
    await (database as any).query(
      `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)`,
      [
        options.workspaceId,
        'tenant_alpha',
        'service_account',
        'svc_enabled',
        'E2E Workspace',
        now,
      ],
    );
  }
  // The repository implementations intentionally accept the common query/
  // connect shape shared by PGlite and pg.Pool. Keep the fixture seam broad so
  // callers can inject a real pool without changing production repositories.
  const repositoryDatabase = database as any;
  const sessions = new PostgresSessionRepository(repositoryDatabase);
  if (options.sessionRepositoryControl)
    options.sessionRepositoryControl.repository = sessions;
  const events = new PostgresRunEventRepository(repositoryDatabase);

  const runRepository = new PostgresRunRepository(repositoryDatabase);
  const taskRepository = new PostgresTaskRepository(repositoryDatabase);
  const admissionRepository = new PostgresAdmissionRepository(
    repositoryDatabase,
  );
  const invokableRepository = new PostgresInvokableRepository(
    repositoryDatabase,
  );
  const resolveAgentVersion = canonicalAgentResolver(repositoryDatabase);
  const workspaceMemoryRepository = new PostgresWorkspaceMemoryRepository(
    repositoryDatabase,
  );
  const projectedMemory = new Map<string, string>();
  let projectionFailures = options.projectionFailures ?? 0;
  const fileStore = {
    publish: async (snapshot: { snapshotId: string; memory: string }) => {
      if (projectionFailures > 0) {
        projectionFailures -= 1;
        throw new Error('projection failure');
      }
      projectedMemory.set(snapshot.snapshotId, snapshot.memory);
    },
    readVerified: async (input: { snapshotId: string }) => {
      const content = projectedMemory.get(input.snapshotId);
      if (content === undefined)
        throw new Error('Memory snapshot verification failed');
      return content;
    },
  };
  const managedMemory = new ManagedMemory(database as any, fileStore);
  if (options.memoryReviewControl) {
    options.memoryReviewControl.managedMemory = managedMemory;
  }
  await seedDefaultPublishedAgent(
    repositoryDatabase,
    options.workspaceId ?? testConfig.serviceAccounts[0].workspaceId,
    options.publishedAgentVersionId,
  );
  const logger = createLogger({
    service: testConfig.serviceName,
    minimumLevel: 'error',
    write: () => undefined,
  });
  const memoryModule = createMemoryModule({
    database: repositoryDatabase,
    tasks: taskRepository,
    sessions,
    config: effectiveConfig as any,
  });
  Object.assign(memoryModule.http, { managedMemory });
  const resourceModule = await createResourceModule({
    database: repositoryDatabase,
    // Keep each fixture's registry isolated so concurrent tests cannot race on
    // immutable skill objects or refs. Resolve the OS temp directory first;
    // the registry rejects symlinked path components.
    config: {
      ...(effectiveConfig as any),
      skillRegistryRoot: join(
        await realpath(tmpdir()),
        `agent-server-test-skill-registry-${randomUUID()}`,
      ),
      serviceAccounts: [],
    },
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
  const workModule = createWorkModule({
    database: repositoryDatabase,
    definitions: resourceModule.definitionReadApi,
    definitionResolution: resourceModule.workDefinitionResolution,
    execution: new InvokeTaskExecutionAdmission(invokeTask),
    executionFacts: new PostgresExecutionFactQuery(repositoryDatabase),
    runtimeCapabilities: createConfiguredRuntimeCapabilities(testConfig),
  });
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
  if (options.memoryReviewControl) {
    options.memoryReviewControl.review = reviewMemoryProposal;
  }
  const listMemoryEntries = new ListMemoryEntries(workspaceMemoryRepository);
  const completeRun = new CompleteRun(
    runRepository,
    taskRepository,
    events,
    sessions,
    options.memoryReviewNotifier
      ? {
          notifySucceeded: (input) =>
            options.memoryReviewNotifier!.execute(input),
        }
      : undefined,
  );
  const cancelTask = new CancelTask(
    taskRepository,
    runRepository,
    runtime,
    events,
  );
  const executeTeamTask = new ExecuteTeamTask(invokableRepository, {} as never);
  const executeRun = new ExecuteRun({
    completeRun,
    tasks: taskRepository,
    definitions: invokableRepository,
    executeTeamTask,
    runtime,
    runtimeProvider: runtime,
    logger,
    resolver: resolveAgentVersion,
    events,
    fileStore,
    createMemoryProposal,
  });
  const dispatcher = new PostgresRunDispatcher(
    new ClaimNextRun(runRepository, {
      workerId,
      leaseDurationMs: 30_000,
    }),
    executeRun,
    logger,
    { pollIntervalMs: 1 },
  );
  if (options.dispatcherControl)
    options.dispatcherControl.dispatcher = dispatcher;
  if (options.startDispatcher ?? true) {
    dispatcher.start();
  }

  if (options.workspaceMemoryFixtureControl) {
    options.workspaceMemoryFixtureControl.seedAcceptedEntry = async (
      workspaceId,
      content,
    ) => {
      const accessContext = {
        tenantId: 'tenant_alpha',
        workspaceId,
        principalType: 'service_account' as const,
        principalId: 'svc_enabled',
        serviceAccountId: 'svc_enabled',
        policySnapshotVersion: 'policy-2026-07-22',
      };
      const proposal = await createMemoryProposal.execute({
        content,
        category: 'fact',
        accessContext,
      });
      const reviewed = await reviewMemoryProposal.execute({
        proposalId: proposal.id,
        action: 'accept',
        accessContext,
      });
      if (!reviewed.entry) throw new Error('fixture entry was not accepted');
      const snapshot = await managedMemory.acceptEntry(reviewed.entry);
      return {
        proposalId: proposal.id,
        entryId: reviewed.entry.id,
        snapshotId: snapshot.snapshotId,
        contentHash: snapshot.contentHash,
      };
    };
  }

  return createHttpApp({
    config: effectiveConfig,
    logger,
    readiness: new RuntimeReadinessProbe({
      health: () => runtime.planeHealth(),
    }),
    runtime,
    submitRun,
    getRun,
    invokeTask,
    getTask,
    getTaskTree,
    teamExecutions: {} as never,
    teamDriver: {} as never,
    teamMessages: {} as never,
    tasks: taskRepository,
    sessions,
    events,
    cancelTask,
    submitSessionTurn: {} as never,
    workModule,
    memoryModule,
    resourceModule,
  });
}

async function seedDefaultPublishedAgent(
  database: TestDatabase,
  workspaceId: string,
  versionId = defaultPublishedAgentVersionId,
): Promise<void> {
  await seedCanonicalPublishedAgent(
    database as any,
    {
      tenantId: 'tenant_alpha',
      workspaceId,
      principalType: 'service_account',
      principalId: 'svc_enabled',
      policySnapshotVersion: 'policy-2026-07-22',
    },
    {
      definitionId:
        versionId === defaultPublishedAgentVersionId
          ? '00000000-0000-4000-8000-0000000a0001'
          : randomUUID(),
      versionId,
      name: 'Default Task Agent',
      description: 'Seeded canonical managed test Agent',
      instructions: 'Do the task.',
      now: new Date('2026-07-22T12:00:00.000Z'),
    },
  );
}
