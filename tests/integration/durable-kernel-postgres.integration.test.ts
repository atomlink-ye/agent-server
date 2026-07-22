import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { ClaimNextRun } from '../../src/application/runs/claim-next-run.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import {
  AdmitRootTask,
  IdempotencyConflictError,
} from '../../src/application/tasks/admit-root-task.js';
import { transitionRun } from '../../src/domain/runs/run.js';
import {
  applyDurableKernelMigrations,
  readDurableKernelMigration,
  resolveDurableKernelMigrationFilePath,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { TestClock } from '../fixtures/test-clock.js';

const primaryAccessContext = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account' as const,
  principalId: 'svc_alpha',
  policySnapshotVersion: 'policy-2026-07-22',
};

function createAccessContext(
  overrides: Partial<typeof primaryAccessContext> = {},
) {
  return {
    ...primaryAccessContext,
    ...overrides,
  };
}

async function createDatabase(): Promise<PGlite> {
  return new PGlite();
}

interface CompletedDispatchRow {
  readonly status: string;
  readonly result: { readonly text: string } | null;
  readonly lease_owner: string | null;
  readonly activation_id: string | null;
  readonly published_at: string | Date | null;
}

describe('durable kernel postgres bootstrap', () => {
  it('loads the migration SQL from the source tree for dist runtime paths', async () => {
    const distModuleUrl = new URL(
      '../../dist/infrastructure/postgres/postgres.js',
      import.meta.url,
    ).href;

    const sql = await readDurableKernelMigration(
      resolveDurableKernelMigrationFilePath(
        '0001_durable_kernel_a.sql',
        distModuleUrl,
      ),
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tasks');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS runs');
  });

  it('applies the durable kernel migration only once and records its version', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);
    await applyDurableKernelMigrations(database);

    const migrationRows = await database.query(
      'SELECT version FROM durable_kernel_schema_migrations ORDER BY version ASC',
    );
    const taskRows = await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'tasks'",
    );
    const runRows = await database.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'runs'",
    );

    expect(migrationRows.rows).toEqual([
      { version: '0001_durable_kernel_a' },
      { version: '0002_phase_2a_authenticated_admission' },
    ]);
    expect(taskRows.rows).toEqual([{ table_name: 'tasks' }]);
    expect(runRows.rows).toEqual([{ table_name: 'runs' }]);
  });

  it('re-records a migration version when schema exists but the registry row is missing', async () => {
    const database = await createDatabase();
    const migrationSql = await readDurableKernelMigration();

    await database.exec(migrationSql);
    await database.query(`
      CREATE TABLE IF NOT EXISTS durable_kernel_schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await applyDurableKernelMigrations(database);

    const migrationRows = await database.query(
      'SELECT version FROM durable_kernel_schema_migrations ORDER BY version ASC',
    );

    expect(migrationRows.rows).toEqual([
      { version: '0001_durable_kernel_a' },
      { version: '0002_phase_2a_authenticated_admission' },
    ]);
  });

  it('enforces canonical root-task and run-state invariants', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    await expect(
      database.query(`
        INSERT INTO tasks (
          id,
          tenant_id,
          root_task_id,
          parent_task_id,
          parent_run_id,
          depth,
          status,
          workspace_id,
          principal_type,
          principal_id,
          policy_snapshot_version,
          ingress,
          invokable_kind,
          invokable_version_id,
          input_snapshot_ref,
          input_fingerprint,
          created_at,
          updated_at
        ) VALUES (
          'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
          'tenant_local',
          '8692ed31-fc15-4bd8-ab00-bce97ae4024d',
          NULL,
          NULL,
          0,
          'queued',
          'workspace_main',
          'service_account',
          'svc_alpha',
          'policy-2026-07-22',
          'api',
          'agent',
          'baseline-run-api',
          'inline:prompt',
          'sha256:abc',
          '2026-07-22T12:00:00.000Z',
          '2026-07-22T12:00:00.000Z'
        )
      `),
    ).rejects.toThrow(/tasks_root_shape_check|tasks_root_task_fk/);

    await database.query(`
      INSERT INTO tasks (
        id,
        tenant_id,
        root_task_id,
        parent_task_id,
        parent_run_id,
        depth,
        status,
        workspace_id,
        principal_type,
        principal_id,
        policy_snapshot_version,
        ingress,
        invokable_kind,
        invokable_version_id,
        input_snapshot_ref,
        input_fingerprint,
        created_at,
        updated_at
      ) VALUES (
        'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
        'tenant_local',
        'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
        NULL,
        NULL,
        0,
        'queued',
        'workspace_main',
        'service_account',
        'svc_alpha',
        'policy-2026-07-22',
        'api',
        'agent',
        'baseline-run-api',
        'inline:prompt',
        'sha256:abc',
        '2026-07-22T12:00:00.000Z',
        '2026-07-22T12:00:00.000Z'
      )
    `);

    await expect(
      database.query(`
        INSERT INTO runs (
          id,
          task_id,
          attempt,
          status,
          lease_owner,
          activation_id,
          fencing_token,
          lease_expires_at,
          runtime,
          result,
          usage,
          error,
          created_at,
          updated_at
        ) VALUES (
          '47d4c8e0-ee39-4c19-95b9-a121627728f0',
          'bf3d2bc7-2db0-4c80-9790-42e388bf0b63',
          1,
          'running',
          NULL,
          NULL,
          1,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-07-22T12:00:00.000Z',
          '2026-07-22T12:00:00.000Z'
        )
      `),
    ).rejects.toThrow(/runs_state_check/);
  });

  it('materializes durable admission state and reuses it idempotently', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      new PostgresRunRepository(database),
      new PostgresAdmissionRepository(database),
    );

    const first = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
      accessContext: primaryAccessContext,
    });
    const second = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'same-key',
      accessContext: primaryAccessContext,
    });

    expect(second).toEqual({ ...first, reused: true });

    const taskRows = await database.query(
      'SELECT id, root_task_id, status, tenant_id, workspace_id, principal_type, principal_id, policy_snapshot_version, input_snapshot_ref FROM tasks ORDER BY created_at ASC',
    );
    const runRows = await database.query(
      'SELECT id, task_id, attempt, status FROM runs ORDER BY created_at ASC',
    );
    const admissionRows = await database.query(
      'SELECT ingress, idempotency_key, task_id, tenant_id, workspace_id, principal_type, principal_id, policy_snapshot_version FROM admissions ORDER BY id ASC',
    );
    const dispatchRows = await database.query(
      'SELECT run_id, event_type, published_at FROM run_dispatches ORDER BY id ASC',
    );

    expect(taskRows.rows).toHaveLength(1);
    expect(taskRows.rows?.[0]).toMatchObject({
      id: first.taskId,
      root_task_id: first.taskId,
      status: 'queued',
      tenant_id: primaryAccessContext.tenantId,
      workspace_id: primaryAccessContext.workspaceId,
      principal_type: primaryAccessContext.principalType,
      principal_id: primaryAccessContext.principalId,
      policy_snapshot_version: primaryAccessContext.policySnapshotVersion,
    });
    expect(runRows.rows).toEqual([
      {
        id: first.runId,
        task_id: first.taskId,
        attempt: 1,
        status: 'queued',
      },
    ]);
    expect(admissionRows.rows).toEqual([
      {
        ingress: 'api',
        idempotency_key: 'same-key',
        task_id: first.taskId,
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: primaryAccessContext.principalId,
        policy_snapshot_version: primaryAccessContext.policySnapshotVersion,
      },
    ]);
    expect(dispatchRows.rows).toEqual([
      {
        run_id: first.runId,
        event_type: 'run.enqueue',
        published_at: null,
      },
    ]);
  });

  it('rejects mismatched admission reuse for the same idempotency key', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      new PostgresRunRepository(database),
      new PostgresAdmissionRepository(database),
    );

    await useCase.execute({
      prompt: 'first prompt',
      idempotencyKey: 'same-key',
      accessContext: primaryAccessContext,
    });

    await expect(
      useCase.execute({
        prompt: 'different prompt',
        idempotencyKey: 'same-key',
        accessContext: primaryAccessContext,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('creates separate admissions for the same idempotency key in different owner scopes and ignores policy version for replay matching', async () => {
    const database = await createDatabase();

    await applyDurableKernelMigrations(database);

    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      new PostgresRunRepository(database),
      new PostgresAdmissionRepository(database),
    );

    const first = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'shared-key',
      accessContext: createAccessContext({
        policySnapshotVersion: 'policy-v1',
      }),
    });
    const replay = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'shared-key',
      accessContext: createAccessContext({
        policySnapshotVersion: 'policy-v2',
      }),
    });
    const secondScope = await useCase.execute({
      prompt: 'same prompt',
      idempotencyKey: 'shared-key',
      accessContext: createAccessContext({
        principalId: 'svc_beta',
        policySnapshotVersion: 'policy-v9',
      }),
    });

    expect(replay).toEqual({ ...first, reused: true });
    expect(secondScope.reused).toBe(false);
    expect(secondScope.taskId).not.toBe(first.taskId);
    expect(secondScope.runId).not.toBe(first.runId);

    const taskRows = await database.query(
      'SELECT id, tenant_id, workspace_id, principal_type, principal_id, policy_snapshot_version FROM tasks ORDER BY principal_id ASC',
    );
    const admissionRows = await database.query(
      'SELECT ingress, idempotency_key, tenant_id, workspace_id, principal_type, principal_id, policy_snapshot_version, task_id FROM admissions ORDER BY principal_id ASC',
    );

    expect(taskRows.rows).toEqual([
      {
        id: first.taskId,
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: primaryAccessContext.principalId,
        policy_snapshot_version: 'policy-v1',
      },
      {
        id: secondScope.taskId,
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: 'svc_beta',
        policy_snapshot_version: 'policy-v9',
      },
    ]);
    expect(admissionRows.rows).toEqual([
      {
        ingress: 'api',
        idempotency_key: 'shared-key',
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: primaryAccessContext.principalId,
        policy_snapshot_version: 'policy-v1',
        task_id: first.taskId,
      },
      {
        ingress: 'api',
        idempotency_key: 'shared-key',
        tenant_id: primaryAccessContext.tenantId,
        workspace_id: primaryAccessContext.workspaceId,
        principal_type: primaryAccessContext.principalType,
        principal_id: 'svc_beta',
        policy_snapshot_version: 'policy-v9',
        task_id: secondScope.taskId,
      },
    ]);
  });

  it('claims one queued dispatched run atomically with lease metadata and publishes the dispatch', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const useCase = new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    );
    const admission = await useCase.execute({
      prompt: 'claim me once',
      idempotencyKey: 'claim-key',
      accessContext: primaryAccessContext,
    });

    clock.advanceMs(30_000);

    const claimed = await new ClaimNextRun(runRepository, {
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      now: clock.now,
      activationIdFactory: () => '00000000-0000-4000-8000-000000000111',
    }).execute();

    expect(claimed).toMatchObject({
      run: {
        id: admission.runId,
        status: 'running',
        updatedAt: '2026-07-22T12:00:30.000Z',
      },
      workerId: 'worker-a',
      activationId: '00000000-0000-4000-8000-000000000111',
      fencingToken: 1,
      leaseExpiresAt: '2026-07-22T12:01:30.000Z',
    });
    await expect(
      new ClaimNextRun(runRepository, {
        workerId: 'worker-b',
        leaseDurationMs: 60_000,
        now: clock.now,
        activationIdFactory: () => '00000000-0000-4000-8000-000000000222',
      }).execute(),
    ).resolves.toBeNull();

    const runRows = await database.query(
      `
        SELECT
          status,
          lease_owner,
          activation_id,
          fencing_token,
          lease_expires_at::text AS lease_expires_at
        FROM runs
        WHERE id = $1
      `,
      [admission.runId],
    );
    const dispatchRows = await database.query(
      `
        SELECT event_type, published_at::text AS published_at
        FROM run_dispatches
        WHERE run_id = $1
      `,
      [admission.runId],
    );

    expect(runRows.rows).toEqual([
      {
        status: 'running',
        lease_owner: 'worker-a',
        activation_id: '00000000-0000-4000-8000-000000000111',
        fencing_token: 1,
        lease_expires_at: '2026-07-22 12:01:30+00',
      },
    ]);
    expect(dispatchRows.rows).toEqual([
      {
        event_type: 'run.enqueue',
        published_at: '2026-07-22 12:00:30+00',
      },
    ]);
  });

  it('rejects a stale fenced terminal completion after a newer owner exists', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const admission = await new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    ).execute({
      prompt: 'stale completion prompt',
      idempotencyKey: 'stale-completion-key',
      accessContext: primaryAccessContext,
    });

    clock.advanceMs(30_000);
    const claimed = await new ClaimNextRun(runRepository, {
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      now: clock.now,
      activationIdFactory: () => '00000000-0000-4000-8000-000000000311',
    }).execute();
    expect(claimed).not.toBeNull();

    clock.advanceMs(5_000);
    await database.query(
      `
        UPDATE runs
        SET
          lease_owner = $2,
          activation_id = $3,
          fencing_token = $4,
          lease_expires_at = $5,
          updated_at = $6
        WHERE id = $1
      `,
      [
        admission.runId,
        'worker-b',
        '00000000-0000-4000-8000-000000000399',
        2,
        '2026-07-22T12:01:35.000Z',
        '2026-07-22T12:00:35.000Z',
      ],
    );

    clock.advanceMs(5_000);
    const terminal = transitionRun(
      claimed!.run,
      'succeeded',
      {
        runtime: { provider: 'opencode', model: 'opencode/fake-free' },
        result: { text: 'STALE_WRITE' },
      },
      clock.now,
    );

    await expect(
      new CompleteRun(runRepository).execute({
        claim: claimed!,
        run: terminal,
      }),
    ).rejects.toThrow(/stale|fenc/i);
  });

  it('persists a fenced terminal completion and clears lease metadata', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const admission = await new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    ).execute({
      prompt: 'complete me once',
      idempotencyKey: 'complete-key',
      accessContext: primaryAccessContext,
    });

    clock.advanceMs(20_000);
    const claimed = await new ClaimNextRun(runRepository, {
      workerId: 'worker-a',
      leaseDurationMs: 60_000,
      now: clock.now,
      activationIdFactory: () => '00000000-0000-4000-8000-000000000411',
    }).execute();
    expect(claimed).not.toBeNull();

    clock.advanceMs(10_000);
    const completed = await new CompleteRun(runRepository).execute({
      claim: claimed!,
      run: transitionRun(
        claimed!.run,
        'succeeded',
        {
          runtime: { provider: 'opencode', model: 'opencode/fake-free' },
          result: { text: 'COMPLETE_OK' },
          usage: { inputTokens: 3, outputTokens: 2, totalCostUsd: 0 },
        },
        clock.now,
      ),
    });

    expect(completed).toMatchObject({
      id: claimed!.run.id,
      status: 'succeeded',
      runtime: { provider: 'opencode', model: 'opencode/fake-free' },
      result: { text: 'COMPLETE_OK' },
    });

    const rows = await database.query(
      `
        SELECT
          status,
          lease_owner,
          activation_id,
          fencing_token,
          lease_expires_at,
          runtime,
          result,
          usage,
          error,
          updated_at::text AS updated_at
        FROM runs
        WHERE id = $1
      `,
      [claimed!.run.id],
    );

    expect(rows.rows).toEqual([
      {
        status: 'succeeded',
        lease_owner: null,
        activation_id: null,
        fencing_token: 1,
        lease_expires_at: null,
        runtime: { provider: 'opencode', model: 'opencode/fake-free' },
        result: { text: 'COMPLETE_OK' },
        usage: { inputTokens: 3, outputTokens: 2, totalCostUsd: 0 },
        error: null,
        updated_at: '2026-07-22 12:00:30+00',
      },
    ]);
  });

  it('dispatches durable run.enqueue work through the in-process worker loop', async () => {
    const database = await createDatabase();
    const clock = new TestClock('2026-07-22T12:00:00.000Z');
    const runtime = new FakeAgentRuntime({ responseText: 'DISPATCH_OK' });
    const logger = createLogger({
      service: 'agent-server-test',
      minimumLevel: 'error',
      write: () => undefined,
    });

    await applyDurableKernelMigrations(database);

    const runRepository = new PostgresRunRepository(database);
    const admission = await new AdmitRootTask(
      new PostgresTaskRepository(database),
      runRepository,
      new PostgresAdmissionRepository(database),
      clock.now,
    ).execute({
      prompt: 'dispatch me once',
      idempotencyKey: 'dispatch-key',
      accessContext: primaryAccessContext,
    });

    const dispatcher = new PostgresRunDispatcher(
      new ClaimNextRun(runRepository, {
        workerId: 'worker-loop',
        leaseDurationMs: 60_000,
        now: () => {
          const current = clock.now();
          clock.advanceMs(5_000);
          return current;
        },
        activationIdFactory: () => '00000000-0000-4000-8000-000000000511',
      }),
      new ExecuteRun(
        new CompleteRun(runRepository),
        runtime,
        logger,
        clock.now,
      ),
      logger,
      { pollIntervalMs: 1 },
    );

    dispatcher.start();
    try {
      await waitFor(async () => {
        const run = await runRepository.findById(admission.runId);
        return run?.status === 'succeeded';
      });
    } finally {
      await dispatcher.stop();
    }

    const completedRun = await database.query<CompletedDispatchRow>(
      'SELECT status, result, lease_owner, activation_id, published_at FROM runs INNER JOIN run_dispatches ON run_dispatches.run_id = runs.id WHERE runs.id = $1',
      [admission.runId],
    );
    const completedRow = completedRun.rows?.[0];

    expect(runtime.executeCalls).toBe(1);
    expect(completedRow).toMatchObject({
      status: 'succeeded',
      result: { text: 'DISPATCH_OK' },
      lease_owner: null,
      activation_id: null,
    });
    expect(completedRow?.published_at).not.toBeNull();
  });
});

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error('Timed out waiting for durable dispatch completion');
}
