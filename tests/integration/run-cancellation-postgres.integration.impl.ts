import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { transitionRun } from '../../src/domain/runs/run.js';
import { CancelTask } from '../../src/application/tasks/cancel-task.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const required = process.env.REAL_POSTGRES_REQUIRED === '1';
if (required && !connectionString)
  throw new Error('real PostgreSQL is required');
const describeRealPostgres = connectionString ? describe : describe.skip;

describeRealPostgres('real PostgreSQL run cancellation arbitration', () => {
  const pool = connectionString
    ? createPostgresPool({ connectionString, maxConnections: 4 })
    : null;
  let sequence = 0;

  beforeAll(async () => {
    if (pool) {
      await applyDurableKernelMigrations(pool);
      await pool.query(
        "DELETE FROM runs WHERE task_id IN (SELECT id FROM tasks WHERE tenant_id = 'cancel-test')",
      );
      await pool.query("DELETE FROM tasks WHERE tenant_id = 'cancel-test'");
    }
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('cancels queued runs atomically and prevents a claim or repeated side effects', async () => {
    const ids = await insertRun(pool!, 'queued');
    const repository = new PostgresRunRepository(pool!);
    expect(
      (
        await repository.requestCancellation(
          ids.taskId,
          '2026-07-24T00:00:01.000Z',
        )
      )?.outcome,
    ).toBe('queued_cancelled');
    expect(
      (
        await repository.requestCancellation(
          ids.taskId,
          '2026-07-24T00:00:02.000Z',
        )
      )?.outcome,
    ).toBe('terminal');
    expect(
      await repository.claimQueuedById({
        runId: ids.runId,
        workerId: 'worker',
        activationId: ids.activationId,
        claimedAt: '2026-07-24T00:00:03.000Z',
        leaseExpiresAt: '2026-07-24T00:01:00.000Z',
      }),
    ).toBeNull();
    const row = await pool!.query<{
      status: string;
      error: { code: string };
      updated_at: string;
    }>('SELECT status,error,updated_at FROM runs WHERE id=$1', [ids.runId]);
    expect(row.rows[0]).toMatchObject({
      status: 'cancelled',
      error: { code: 'cancelled' },
    });
    expect(Date.parse(row.rows[0]!.updated_at)).toBeGreaterThanOrEqual(
      Date.parse('2026-07-24T00:00:01.000Z'),
    );
  });

  it('wins cancellation over a claimed success or failure and preserves request timestamp monotonicity', async () => {
    for (const status of ['succeeded', 'failed'] as const) {
      const ids = await insertRun(pool!, 'queued');
      const repository = new PostgresRunRepository(pool!);
      const claim = await repository.claimQueuedById({
        runId: ids.runId,
        workerId: 'worker',
        activationId: ids.activationId,
        claimedAt: '2026-07-24T00:01:00.000Z',
        leaseExpiresAt: '2026-07-24T00:02:00.000Z',
      });
      expect(claim).not.toBeNull();
      expect(
        (
          await repository.requestCancellation(
            ids.taskId,
            '2026-07-24T00:01:01.000Z',
          )
        )?.outcome,
      ).toBe('running_requested');
      expect(
        (
          await repository.requestCancellation(
            ids.taskId,
            '2026-07-24T00:01:00.500Z',
          )
        )?.outcome,
      ).toBe('running_already_requested');
      const candidate = transitionRun(
        claim!.run,
        status,
        status === 'succeeded'
          ? {
              runtime: { provider: 'test', model: 'test' },
              result: { text: 'late' },
              usage: { totalCostUsd: 0 },
            }
          : {
              error: { code: 'runtime_execution_failed', message: 'late' },
              usage: { totalCostUsd: 0 },
            },
        () => new Date('2026-07-24T00:01:00.500Z'),
      );
      const completed = await repository.completeClaimed({
        claim: claim!,
        run: candidate,
      });
      expect(completed.status).toBe('cancelled');
      expect(completed.result).toBeUndefined();
      expect(completed.error?.code).toBe('cancelled');
      const row = await pool!.query<{
        cancellation_requested_at: string;
        updated_at: string;
        usage: { totalCostUsd: number } | null;
      }>(
        'SELECT cancellation_requested_at,updated_at,usage FROM runs WHERE id=$1',
        [ids.runId],
      );
      expect(
        new Date(row.rows[0]!.cancellation_requested_at).toISOString(),
      ).toContain('00:01:01');
      expect(
        new Date(row.rows[0]!.updated_at).getTime(),
      ).toBeGreaterThanOrEqual(new Date('2026-07-24T00:01:01.000Z').getTime());
      expect(row.rows[0]!.usage).toEqual({ totalCostUsd: 0 });
    }
  });

  it('returns terminal for success-before-cancel and rejects stale fencing', async () => {
    const ids = await insertRun(pool!, 'queued');
    const repository = new PostgresRunRepository(pool!);
    const claim = await repository.claimQueuedById({
      runId: ids.runId,
      workerId: 'worker',
      activationId: ids.activationId,
      claimedAt: '2026-07-24T00:03:00.000Z',
      leaseExpiresAt: '2026-07-24T00:04:00.000Z',
    });
    const success = transitionRun(
      claim!.run,
      'succeeded',
      {
        runtime: { provider: 'test', model: 'test' },
        result: { text: 'done' },
      },
      () => new Date('2026-07-24T00:03:01.000Z'),
    );
    expect(
      (await repository.completeClaimed({ claim: claim!, run: success }))
        .status,
    ).toBe('succeeded');
    expect(
      (
        await repository.requestCancellation(
          ids.taskId,
          '2026-07-24T00:03:02.000Z',
        )
      )?.outcome,
    ).toBe('terminal');
    await expect(
      repository.completeClaimed({
        claim: { ...claim!, fencingToken: claim!.fencingToken - 1 },
        run: success,
      }),
    ).rejects.toThrow('stale');
  });

  it('composes CancelTask twice against PostgreSQL and cancels the runtime once', async () => {
    const ids = await insertRun(pool!, 'queued');
    const repository = new PostgresRunRepository(pool!);
    const claim = await repository.claimQueuedById({
      runId: ids.runId,
      workerId: 'worker',
      activationId: ids.activationId,
      claimedAt: '2026-07-24T00:05:00.000Z',
      leaseExpiresAt: '2026-07-24T00:06:00.000Z',
    });
    expect(claim).not.toBeNull();
    let calls = 0;
    const runtime = {
      cancel: async () => {
        calls += 1;
      },
    };
    const cancel = new CancelTask(
      new PostgresTaskRepository(pool!),
      repository,
      runtime as never,
    );
    const owner = {
      tenantId: 'cancel-test',
      workspaceId: 'workspace',
      principalType: 'service_account' as const,
      principalId: 'principal',
      policySnapshotVersion: 'policy',
    };
    expect((await cancel.execute(ids.taskId, owner))?.runId).toBe(ids.runId);
    expect((await cancel.execute(ids.taskId, owner))?.status).toBe(
      'cancellation_requested',
    );
    expect(calls).toBe(1);
  });

  async function insertRun(
    db: NonNullable<typeof pool>,
    status: 'queued' | 'running',
  ) {
    const n = ++sequence;
    const taskId = `00000000-0000-4000-8000-${(2000 + n).toString(16).padStart(12, '0')}`;
    const runId = `00000000-0000-4000-8000-${(3000 + n).toString(16).padStart(12, '0')}`;
    const activationId = `00000000-0000-4000-8000-${(4000 + n).toString(16).padStart(12, '0')}`;
    await db.query(
      `INSERT INTO tasks (id,tenant_id,workspace_id,principal_type,principal_id,policy_snapshot_version,root_task_id,depth,status,ingress,invokable_kind,invokable_version_id,input_snapshot_ref,input_fingerprint,created_at,updated_at) VALUES ($1,'cancel-test','workspace','service_account','principal','policy',$1,0,'queued','api','agent',$2,'inline:run-request:eyJwcm9tcHQiOiJwcm9tcHQifQ','fingerprint',$3,$3)`,
      [taskId, activationId, '2026-01-01T00:00:00.000Z'],
    );
    await db.query(
      `INSERT INTO runs (id,task_id,attempt,status,lease_owner,activation_id,fencing_token,lease_expires_at,runtime,result,usage,error,created_at,updated_at) VALUES ($1,$2,1,$3,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,$4,$4)`,
      [runId, taskId, status, '2026-01-01T00:00:00.000Z'],
    );
    return { taskId, runId, activationId };
  }
});
