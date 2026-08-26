import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { applyDurableKernelMigrations } from './postgres.js';
import { PostgresRunRepository } from './postgres-run-repository.js';
import { transitionRun } from '../../domain/runs/run.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../../application/tasks/root-task-input.js';

interface SeedRunOptions {
  readonly taskId: string;
  readonly runId: string;
  readonly status: 'queued' | 'running';
  readonly leaseExpiresAt?: string;
}

async function seedTaskWithRun(
  db: PGlite,
  options: SeedRunOptions,
): Promise<void> {
  const now = '2026-08-24T00:00:00.000Z';
  await db.query(
    `INSERT INTO tasks (
       id, tenant_id, root_task_id, parent_task_id, parent_run_id, depth,
       status, ingress, invokable_kind, invokable_version_id,
       input_snapshot_ref, input_fingerprint, created_at, updated_at,
       workspace_id, principal_type, principal_id, policy_snapshot_version
     ) VALUES (
       $1, 'tenant-lease', $1, NULL, NULL, 0,
       'active', 'api', 'agent', 'agent@v1',
       $3, 'fingerprint', $2, $2,
       'workspace-lease', 'service_account', 'worker-lease', 'policy-lease'
     )`,
    [
      options.taskId,
      now,
      encodeRootTaskRunRequestSnapshotRef({ prompt: 'run prompt' }),
    ],
  );

  const isRunning = options.status === 'running';
  await db.query(
    `INSERT INTO runs (
       id, task_id, attempt, status, lease_owner, activation_id,
       fencing_token, lease_expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, 1, $3, $4, $5, $6, $7, $8, $8
     )`,
    [
      options.runId,
      options.taskId,
      options.status,
      isRunning ? 'lease-owner' : null,
      isRunning ? '00000000-0000-4000-8000-000000000001' : null,
      isRunning ? 1 : 0,
      isRunning ? options.leaseExpiresAt : null,
      now,
    ],
  );
}

describe('PostgresRunRepository.recoverExpiredRuns', () => {
  it('fails closed only the running run whose lease has expired', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);

    const expiredTaskId = '00000000-0000-4000-8000-0000000000e1';
    const expiredRunId = '00000000-0000-4000-8000-0000000000e2';
    const validTaskId = '00000000-0000-4000-8000-0000000000e3';
    const validRunId = '00000000-0000-4000-8000-0000000000e4';
    const queuedTaskId = '00000000-0000-4000-8000-0000000000e5';
    const queuedRunId = '00000000-0000-4000-8000-0000000000e6';
    const now = '2026-08-24T12:00:00.000Z';

    await seedTaskWithRun(db, {
      taskId: expiredTaskId,
      runId: expiredRunId,
      status: 'running',
      // A worker held this lease and never renewed or completed it: the
      // lease expired well before `now`.
      leaseExpiresAt: '2026-08-24T11:00:00.000Z',
    });
    await seedTaskWithRun(db, {
      taskId: validTaskId,
      runId: validRunId,
      status: 'running',
      // A live worker's lease that has not expired yet must never be touched.
      leaseExpiresAt: '2026-08-24T13:00:00.000Z',
    });
    await seedTaskWithRun(db, {
      taskId: queuedTaskId,
      runId: queuedRunId,
      status: 'queued',
    });

    const repository = new PostgresRunRepository(db);
    const recovered = await repository.recoverExpiredRuns(now);

    expect(recovered).toEqual([{ runId: expiredRunId, taskId: expiredTaskId }]);

    const rows = await db.query<{
      id: string;
      status: string;
      lease_owner: string | null;
      activation_id: string | null;
      lease_expires_at: string | null;
      result: unknown;
      error: { code: string; message: string } | null;
    }>(
      `SELECT id, status, lease_owner, activation_id, lease_expires_at, result, error
       FROM runs
       ORDER BY id`,
    );

    const byId = new Map(rows.rows.map((row) => [row.id, row]));

    const failedClosed = byId.get(expiredRunId);
    expect(failedClosed?.status).toBe('timed_out');
    expect(failedClosed?.lease_owner).toBeNull();
    expect(failedClosed?.activation_id).toBeNull();
    expect(failedClosed?.lease_expires_at).toBeNull();
    expect(failedClosed?.result).toBeNull();
    expect(failedClosed?.error?.code).toBe('runtime_timed_out');

    const untouchedRunning = byId.get(validRunId);
    expect(untouchedRunning?.status).toBe('running');
    expect(untouchedRunning?.lease_owner).toBe('lease-owner');
    expect(untouchedRunning?.lease_expires_at).not.toBeNull();

    const untouchedQueued = byId.get(queuedRunId);
    expect(untouchedQueued?.status).toBe('queued');
    expect(untouchedQueued?.lease_owner).toBeNull();

    await db.close();
  });

  it('is a no-op when no running run has an expired lease', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);

    const taskId = '00000000-0000-4000-8000-0000000000f1';
    const runId = '00000000-0000-4000-8000-0000000000f2';
    await seedTaskWithRun(db, {
      taskId,
      runId,
      status: 'running',
      leaseExpiresAt: '2026-08-24T13:00:00.000Z',
    });

    const repository = new PostgresRunRepository(db);
    const recovered = await repository.recoverExpiredRuns(
      '2026-08-24T12:00:00.000Z',
    );

    expect(recovered).toEqual([]);
    const row = await db.query<{ status: string }>(
      `SELECT status FROM runs WHERE id = $1`,
      [runId],
    );
    expect(row.rows[0]?.status).toBe('running');

    await db.close();
  });
});

describe('PostgresRunRepository run provenance', () => {
  it('preserves immutable task and attempt provenance when reloading a Run', async () => {
    const db = new PGlite();
    await applyDurableKernelMigrations(db);

    const taskId = '00000000-0000-4000-8000-0000000000a1';
    const runId = '00000000-0000-4000-8000-0000000000a2';
    await seedTaskWithRun(db, {
      taskId,
      runId,
      status: 'queued',
    });

    const repository = new PostgresRunRepository(db);
    const reloaded = await repository.findById(runId);

    expect(reloaded).toMatchObject({
      id: runId,
      taskId,
      attempt: 1,
    });
    const transitioned = reloaded
      ? transitionRun(
          reloaded,
          'running',
          {},
          () => new Date(reloaded.updatedAt),
        )
      : null;
    expect(transitioned).toMatchObject({ taskId, attempt: 1 });

    await db.close();
  });
});
