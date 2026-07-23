import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresSessionRepository } from '../../src/infrastructure/postgres/postgres-session-repository.js';
import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { transitionRun } from '../../src/domain/runs/run.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';

const connectionString =
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_server_test';
const owner = {
  tenantId: 'phase_c_test_tenant',
  workspaceId: 'compatibility_workspace',
  principalType: 'service_account' as const,
  principalId: 'phase_c_test_principal',
  policySnapshotVersion: 'phase-c-test',
};

describe('Phase C session lanes on PostgreSQL', () => {
  it('atomically admits concurrent ordered roots and reset cancellation', async () => {
    const pool = new Pool({ connectionString, max: 8 });
    try {
      await applyDurableKernelMigrations(pool);
      const repository = new PostgresSessionRepository(pool);
      const workspace = await repository.createWorkspace(
        `phase-c-${crypto.randomUUID()}`,
        owner,
      );
      const session = await repository.createSession({
        workspaceId: workspace.id,
        agentVersionId: 'phase-c-published-agent',
        owner,
      });
      const first = await repository.postMessage(
        session.id,
        'first',
        crypto.randomUUID(),
        owner,
      );
      const followUps = await Promise.all(
        ['second', 'third', 'fourth'].map((text) =>
          repository.postMessage(session.id, text, crypto.randomUUID(), owner),
        ),
      );
      const messages = await repository.listMessages(session.id, owner);
      expect(
        messages?.map((message: { sequence: number }) => message.sequence),
      ).toEqual([1, 2, 3, 4]);

      const lane = await pool.query(
        'SELECT active_task_id, next_sequence FROM session_lanes WHERE session_id = $1',
        [session.id],
      );
      expect(lane.rows[0]!.active_task_id).toBe(first.taskId);
      expect(Number(lane.rows[0]!.next_sequence)).toBe(5);
      expect(new Set(followUps.map((message) => message.taskId)).size).toBe(3);

      const rows = await pool.query(
        `SELECT t.id, t.status, t.failure_detail, t.generation, t.lane_sequence,
                r.id AS run_id, l.active_task_id, l.active_cancellation_requested
           FROM tasks t
           JOIN runs r ON r.task_id = t.id
           JOIN session_lanes l ON l.session_id = t.session_id
          WHERE t.session_id = $1
          ORDER BY t.lane_sequence`,
        [session.id],
      );
      expect(rows.rows).toHaveLength(4);
      expect(rows.rows.every((row) => row.run_id)).toBe(true);

      const runs = new PostgresRunRepository(pool);
      const tasks = new PostgresTaskRepository(pool);
      const claim = await runs.claimQueuedById({
        runId: first.runId,
        workerId: 'phase-c-worker',
        activationId: crypto.randomUUID(),
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(claim?.taskId).toBe(first.taskId);
      if (!claim) throw new Error('expected first lane run to claim');
      await new CompleteRun(runs, tasks).execute({
        claim,
        run: transitionRun(claim.run, 'succeeded', {
          result: { text: 'done' },
        }),
      });
      const promoted = await pool.query(
        'SELECT active_task_id FROM session_lanes WHERE session_id = $1',
        [session.id],
      );
      expect(promoted.rows[0]!.active_task_id).toBe(followUps[0]!.taskId);

      const reset = await repository.reset(
        session.id,
        owner,
        crypto.randomUUID(),
      );
      expect(reset?.generation).toBe(1);
      const afterReset = await pool.query(
        `SELECT t.id, t.status, t.failure_detail, l.active_task_id,
                l.active_cancellation_requested
           FROM tasks t
           JOIN session_lanes l ON l.session_id = t.session_id
          WHERE t.session_id = $1
          ORDER BY t.lane_sequence`,
        [session.id],
      );
      expect(
        afterReset.rows
          .filter((row) =>
            followUps.slice(1).some((message) => message.taskId === row.id),
          )
          .every(
            (row) =>
              row.status === 'cancelled' &&
              row.failure_detail === 'cancelled_by_reset',
          ),
      ).toBe(true);
      expect(afterReset.rows[0]!.active_task_id).toBe(followUps[0]!.taskId);
      expect(afterReset.rows[0]!.active_cancellation_requested).toBe(true);
      const activeAfterReset = await pool.query(
        `SELECT t.status, t.failure_detail
           FROM tasks t
          WHERE t.id = (SELECT active_task_id FROM session_lanes WHERE session_id = $1)`,
        [session.id],
      );
      expect(activeAfterReset.rows[0]).toEqual({
        status: 'queued',
        failure_detail: null,
      });

      const newGeneration = await repository.postMessage(
        session.id,
        'new generation',
        crypto.randomUUID(),
        owner,
      );
      const blocked = await pool.query(
        'SELECT active_task_id FROM session_lanes WHERE session_id = $1',
        [session.id],
      );
      expect(blocked.rows[0]!.active_task_id).toBe(followUps[0]!.taskId);
      const oldActiveClaim = await runs.claimQueuedById({
        runId: followUps[0]!.runId,
        workerId: 'phase-c-worker-2',
        activationId: crypto.randomUUID(),
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      if (!oldActiveClaim)
        throw new Error('expected reset active run to claim');
      await new CompleteRun(runs, tasks).execute({
        claim: oldActiveClaim,
        run: transitionRun(oldActiveClaim.run, 'succeeded', {
          result: { text: 'done after reset' },
        }),
      });
      const unblocked = await pool.query(
        'SELECT active_task_id FROM session_lanes WHERE session_id = $1',
        [session.id],
      );
      expect(unblocked.rows[0].active_task_id).toBe(newGeneration.taskId);
    } finally {
      await pool.end();
    }
  });
});
