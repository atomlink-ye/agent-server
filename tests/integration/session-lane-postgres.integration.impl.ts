import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresSessionRepository } from '../../src/infrastructure/postgres/postgres-session-repository.js';
import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresWorkspaceMemoryRepository } from '../../src/infrastructure/postgres/postgres-workspace-memory-repository.js';
import { ResolveAgentVersion } from '../../src/application/agents/resolve-agent-version.js';
import { CreateMemoryProposal } from '../../src/application/memory/create-memory-proposal.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { ExecuteTeamTask } from '../../src/application/tasks/execute-team-task.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import { transitionRun } from '../../src/domain/runs/run.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { CancelTask } from '../../src/application/tasks/cancel-task.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const required = process.env.REAL_POSTGRES_REQUIRED === '1';
if (required && !connectionString)
  throw new Error('real PostgreSQL is required');
const describeRealPostgres = connectionString ? describe : describe.skip;
const owner = {
  tenantId: 'phase_c_test_tenant',
  workspaceId: 'compatibility_workspace',
  principalType: 'service_account' as const,
  principalId: 'phase_c_test_principal',
  policySnapshotVersion: 'phase-c-test',
};

describeRealPostgres('Phase C session lanes on PostgreSQL', () => {
  it('atomically admits concurrent ordered roots and reset cancellation', async () => {
    const pool = new Pool({ connectionString: connectionString!, max: 8 });
    try {
      await applyDurableKernelMigrations(pool);
      const repository = new PostgresSessionRepository(pool);
      const workspace = await repository.createWorkspace(
        `phase-c-${crypto.randomUUID()}`,
        owner,
      );
      const definitionId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const publishedAt = new Date().toISOString();
      await pool.query(
        `INSERT INTO agent_definitions(id,tenant_id,workspace_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'phase-c-agent',$6,$6)`,
        [
          definitionId,
          owner.tenantId,
          workspace.id,
          owner.principalType,
          owner.principalId,
          publishedAt,
        ],
      );
      await pool.query(
        `INSERT INTO agent_versions(id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,instructions,created_at,updated_at,published_at) VALUES($1,$2,$3,$4,$5,$6,'published','phase-c-agent','Do the task.',$7,$7,$7)`,
        [
          versionId,
          definitionId,
          owner.tenantId,
          workspace.id,
          owner.principalType,
          owner.principalId,
          publishedAt,
        ],
      );
      const session = await repository.createSession({
        workspaceId: workspace.id,
        agentVersionId: versionId,
        owner,
      });
      const first = await repository.postMessage({
        sessionId: session.id,
        text: 'first',
        idempotencyKey: crypto.randomUUID(),
        owner,
        origin: { channel: 'api', requestId: crypto.randomUUID() },
      });
      const reloadedFirst = await new PostgresTaskRepository(pool).findById(
        first.taskId,
      );
      expect(reloadedFirst?.sourceMessageId).toBe(first.id);
      const followUps = await Promise.all(
        ['second', 'third', 'fourth'].map((text) =>
          repository.postMessage({
            sessionId: session.id,
            text,
            idempotencyKey: crypto.randomUUID(),
            owner,
            origin: { channel: 'api', requestId: crypto.randomUUID() },
          }),
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
      const invokables = new PostgresInvokableRepository(pool);
      const claim = await runs.claimQueuedById({
        runId: first.runId,
        workerId: 'phase-c-worker',
        activationId: crypto.randomUUID(),
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(claim?.taskId).toBe(first.taskId);
      if (!claim) throw new Error('expected first lane run to claim');
      const runtime = new FakeAgentRuntime({
        responseText: 'done',
        memoryCandidates: [
          {
            content: 'REAL_PG_PRODUCT_SESSION_CANDIDATE',
            category: 'project_constraint',
          },
        ],
      });
      const complete = new CompleteRun(runs, tasks, undefined, repository);
      const execute = new ExecuteRun(
        complete,
        tasks,
        invokables,
        new ExecuteTeamTask(invokables, {} as never),
        runtime,
        createLogger({
          service: 'session-lane-test',
          minimumLevel: 'error',
          write: () => undefined,
        }),
        undefined,
        new ResolveAgentVersion(
          {
            findVersion: async () =>
              ({
                status: 'published',
                id: versionId,
                package: {
                  spec: {
                    instructions: 'instructions',
                    tools: [],
                    skills: [],
                    memory: { proposalLimit: 1 },
                    runtime: { modelPolicyRef: 'free-only' },
                  },
                },
              }) as never,
            findVersionByTenant: async () =>
              ({
                status: 'published',
                id: versionId,
                package: {
                  spec: {
                    instructions: 'instructions',
                    tools: [],
                    skills: [],
                    memory: { proposalLimit: 1 },
                    runtime: { modelPolicyRef: 'free-only' },
                  },
                },
              }) as never,
          },
          invokables,
          { resolve: async () => null },
        ),
        undefined,
        undefined,
        new CreateMemoryProposal(
          new PostgresWorkspaceMemoryRepository(pool),
          tasks,
        ),
      );
      await execute.execute(claim);
      const proposals = await new PostgresWorkspaceMemoryRepository(
        pool,
      ).listProposalsByOwnerScope({ ...owner, workspaceId: workspace.id });
      expect(proposals).toHaveLength(1);
      expect(proposals[0]).toMatchObject({
        originalContent: 'REAL_PG_PRODUCT_SESSION_CANDIDATE',
        originalCategory: 'project_constraint',
        sourceTaskId: first.taskId,
        sourceSessionId: session.id,
        sourceMessageId: first.id,
        sourceRunId: first.runId,
        sourceAgentVersionId: versionId,
        sourceCandidateIndex: 0,
        status: 'pending',
      });
      const completedMessages = await repository.listMessages(
        session.id,
        owner,
      );
      expect(
        completedMessages?.find(
          (message: { role: string }) => message.role === 'assistant',
        ),
      ).toMatchObject({
        sequence: 5,
        text: 'done',
        taskId: first.taskId,
        runId: first.runId,
      });
      const laneAfterAssistant = await pool.query(
        'SELECT next_sequence FROM session_lanes WHERE session_id = $1',
        [session.id],
      );
      expect(Number(laneAfterAssistant.rows[0]!.next_sequence)).toBe(6);
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

      const newGeneration = await repository.postMessage({
        sessionId: session.id,
        text: 'new generation',
        idempotencyKey: crypto.randomUUID(),
        owner,
        origin: { channel: 'api', requestId: crypto.randomUUID() },
      });
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

  it('promotes exactly the next task after active cancellation without an assistant message', async () => {
    const pool = new Pool({ connectionString: connectionString!, max: 8 });
    try {
      await applyDurableKernelMigrations(pool);
      const repository = new PostgresSessionRepository(pool);
      const workspace = await repository.createWorkspace(
        `cancel-lane-${crypto.randomUUID()}`,
        owner,
      );
      const definitionId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const now = '2026-01-01T00:00:00.000Z';
      await pool.query(
        `INSERT INTO agent_definitions(id,tenant_id,workspace_id,principal_type,principal_id,name,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'cancel-lane-agent',$6,$6)`,
        [
          definitionId,
          owner.tenantId,
          workspace.id,
          owner.principalType,
          owner.principalId,
          now,
        ],
      );
      await pool.query(
        `INSERT INTO agent_versions(id,definition_id,tenant_id,workspace_id,principal_type,principal_id,status,name,instructions,created_at,updated_at,published_at) VALUES($1,$2,$3,$4,$5,$6,'published','cancel-lane-agent','Do the task.',$7,$7,$7)`,
        [
          versionId,
          definitionId,
          owner.tenantId,
          workspace.id,
          owner.principalType,
          owner.principalId,
          now,
        ],
      );
      const session = await repository.createSession({
        workspaceId: workspace.id,
        agentVersionId: versionId,
        owner,
      });
      const first = await repository.postMessage({
        sessionId: session.id,
        text: 'first',
        idempotencyKey: crypto.randomUUID(),
        owner,
        origin: { channel: 'api', requestId: crypto.randomUUID() },
      });
      const second = await repository.postMessage({
        sessionId: session.id,
        text: 'second',
        idempotencyKey: crypto.randomUUID(),
        owner,
        origin: { channel: 'api', requestId: crypto.randomUUID() },
      });
      const runs = new PostgresRunRepository(pool);
      const tasks = new PostgresTaskRepository(pool);
      const claim = await runs.claimQueuedById({
        runId: first.runId,
        workerId: 'cancel-lane-worker',
        activationId: crypto.randomUUID(),
        claimedAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(claim?.taskId).toBe(first.taskId);
      const cancelOwner = {
        ...owner,
        workspaceId: workspace.id,
        policySnapshotVersion: 'phase-c-test',
      };
      const runtime = new FakeAgentRuntime();
      const cancelled = await new CancelTask(tasks, runs, runtime).execute(
        first.taskId,
        cancelOwner,
      );
      expect(cancelled?.status).toBe('cancellation_requested');
      expect(runtime.cancelCalls).toBe(1);
      const complete = new CompleteRun(runs, tasks, undefined, repository);
      const persisted = await complete.execute({
        claim: claim!,
        run: transitionRun(claim!.run, 'succeeded', {
          result: { text: 'late success' },
        }),
      });
      expect(persisted.status).toBe('cancelled');
      const lane = await pool.query(
        'SELECT active_task_id FROM session_lanes WHERE session_id=$1',
        [session.id],
      );
      expect(lane.rows[0]!.active_task_id).toBe(second.taskId);
      const messages = await repository.listMessages(session.id, owner);
      expect(
        messages?.filter(
          (message: { role: string }) => message.role === 'assistant',
        ),
      ).toHaveLength(0);
      expect((await tasks.findById(first.taskId))?.status).toBe('cancelled');
    } finally {
      await pool.end();
    }
  });
});
