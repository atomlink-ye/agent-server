import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import {
  createApplication,
  type ApplicationControls,
} from '../../src/composition/create-application.js';
import type { FakeAgentRuntime } from './fake-agent-runtime.js';
import type { FileStore } from '../../src/application/ports/file-store.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import type { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.js';
import type { PostgresSessionRepository } from '../../src/infrastructure/postgres/postgres-session-repository.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import type { AppConfig } from '../../src/shared/config.js';
import type { PublishMemoryReviewSurface } from '../../src/application/channels/publish-memory-review-surface.js';
import type { MemoryReviewApi } from '../../src/application/ports/memory-review-api.js';
import { seedCanonicalPublishedAgent } from './canonical-agent.js';

export const primaryServiceAccountToken = 'token-enabled';
export const secondaryServiceAccountToken = 'token-other-owner';
export const disabledServiceAccountToken = 'token-disabled';
export const defaultPublishedAgentVersionId =
  '00000000-0000-4000-8000-0000000a0101';
export const defaultWorkspaceId = '00000000-0000-4000-8000-00000000a001';
const foreignWorkspaceId = '00000000-0000-4000-8000-00000000a002';

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
      workspaceId: defaultWorkspaceId,
      policyVersion: 'policy-2026-07-22',
      disabled: false,
    },
    {
      serviceAccountId: 'svc_other_owner',
      token: secondaryServiceAccountToken,
      tenantId: 'tenant_alpha',
      workspaceId: defaultWorkspaceId,
      policyVersion: 'policy-2026-07-22',
      disabled: false,
    },
    {
      serviceAccountId: 'svc_disabled',
      token: disabledServiceAccountToken,
      tenantId: 'tenant_alpha',
      workspaceId: defaultWorkspaceId,
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
    review?: MemoryReviewApi['review'];
    managedMemory?: MemoryReviewApi['managedMemory'];
  };
  readonly memoryReviewNotifier?: Pick<PublishMemoryReviewSurface, 'execute'>;
  readonly loggerControl?: { lines?: string[] };
}

export type TestDatabase = {
  query<Row = Record<string, unknown>>(
    ...args: readonly unknown[]
  ): Promise<{ rows: readonly Row[]; [key: string]: unknown }>;
  exec?(sql: string): Promise<unknown>;
  connect?(): Promise<any>;
  close?(): Promise<void>;
  end?(): Promise<void>;
};

export async function createTestApp(
  runtime: FakeAgentRuntime,
  options: CreateTestAppOptions = {},
) {
  const database = withTransactionClient(
    (options.database ?? new PGlite()) as TestDatabase,
  );
  await applyDurableKernelMigrations(database as any);
  if (options.seedPublishedEnvironment)
    await seedPublishedEnvironment(database);
  if (options.databaseControl) options.databaseControl.database = database;

  const effectiveConfig = options.workspaceId
    ? {
        ...testConfig,
        serviceAccounts: testConfig.serviceAccounts.map((account) => ({
          ...account,
          workspaceId:
            account.serviceAccountId === 'svc_enabled'
              ? options.workspaceId!
              : foreignWorkspaceId,
        })),
      }
    : testConfig;
  const fixtureWorkspaceId = options.workspaceId ?? defaultWorkspaceId;
  const now = new Date().toISOString();
  await (database as any).query(
    `INSERT INTO workspaces(id,tenant_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)`,
    [
      fixtureWorkspaceId,
      'tenant_alpha',
      'service_account',
      'svc_enabled',
      'E2E Workspace',
      now,
    ],
  );

  const projectedMemory = new Map<string, string>();
  let projectionFailures = options.projectionFailures ?? 0;
  const fileStore: FileStore = {
    publish: async (snapshot) => {
      if (projectionFailures > 0) {
        projectionFailures -= 1;
        throw new Error('projection failure');
      }
      projectedMemory.set(snapshot.snapshotId, snapshot.memory);
    },
    readVerified: async (input) => {
      const content = projectedMemory.get(input.snapshotId);
      if (content === undefined)
        throw new Error('Memory snapshot verification failed');
      return content;
    },
  };
  const logger = createLogger({
    service: testConfig.serviceName,
    minimumLevel: 'error',
    write: (line) => options.loggerControl?.lines?.push(line),
  });
  const fixtureConfig = {
    ...effectiveConfig,
    skillRegistryRoot: join(
      await realpath(tmpdir()),
      `agent-server-test-skill-registry-${randomUUID()}`,
    ),
  };
  await seedDefaultPublishedAgent(
    database,
    fixtureWorkspaceId,
    options.publishedAgentVersionId,
  );

  const application = await createApplication(
    fixtureConfig as unknown as AppConfig,
    logger,
    {
      singleRunDebug: true,
      database: database as any,
      fileStore,
      runtimeProvider: runtime.asRuntimeProvider(),
      ...(options.memoryReviewNotifier
        ? { memoryReviewNotifier: options.memoryReviewNotifier }
        : {}),
    },
  );
  const controls = application.controls as ApplicationControls;
  if (options.dispatcherControl)
    options.dispatcherControl.dispatcher = controls.dispatcher;
  if (options.sessionRepositoryControl)
    options.sessionRepositoryControl.repository = controls.sessions;
  if (options.memoryReviewControl) {
    options.memoryReviewControl.review = controls.memoryModule.reviewApi.review;
    options.memoryReviewControl.managedMemory =
      controls.memoryModule.http.managedMemory;
  }
  if (options.startDispatcher ?? true)
    application.singleRunDebug?.startDispatcher();

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
      const proposal = await controls.memoryModule.createMemoryProposal.execute(
        {
          content,
          category: 'fact',
          accessContext,
        },
      );
      const reviewed = await controls.memoryModule.reviewApi.review.execute({
        proposalId: proposal.id,
        action: 'accept',
        accessContext,
      });
      if (!reviewed.entry) throw new Error('fixture entry was not accepted');
      const snapshot =
        await controls.memoryModule.http.managedMemory.acceptEntry(
          reviewed.entry,
        );
      return {
        proposalId: proposal.id,
        entryId: reviewed.entry.id,
        snapshotId: snapshot.snapshotId,
        contentHash: snapshot.contentHash,
      };
    };
  }
  return application.app;
}

function withTransactionClient(database: TestDatabase): TestDatabase {
  if (!(database instanceof PGlite)) return database;
  const query: TestDatabase['query'] = async <Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ) => {
    const result = await database.query<Row>(
      sql,
      values as unknown[] | undefined,
    );
    return { ...result, rowCount: result.affectedRows };
  };
  const close = database.close.bind(database);
  return {
    query,
    close,
    exec: database.exec.bind(database),
    async connect() {
      return {
        query,
        exec: database.exec.bind(database),
        release: () => undefined,
      };
    },
  };
}

async function seedPublishedEnvironment(database: TestDatabase): Promise<void> {
  const now = new Date().toISOString();
  await (database as any).query(
    `INSERT INTO environment_definitions(id,tenant_id,principal_type,principal_id,normalized_name,display_name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
    [
      '00000000-0000-4000-8000-0000000e0101',
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
      '00000000-0000-4000-8000-0000000e0102',
      '00000000-0000-4000-8000-0000000e0101',
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
