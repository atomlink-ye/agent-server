import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  applyDurableKernelMigrations,
  resolveDurableKernelMigrationFilePath,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { AdmitRootTask } from '../../src/application/tasks/admit-root-task.js';
import { ClaimNextRun } from '../../src/application/runs/claim-next-run.js';
import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { ExecuteTeamTask } from '../../src/application/tasks/execute-team-task.js';
import { PostgresRunDispatcher } from '../../src/infrastructure/postgres/postgres-run-dispatcher.js';
import { ManagedMemory } from '../../src/application/memory/managed-memory.js';
import {
  createTestApp,
  defaultPublishedAgentVersionId,
  primaryServiceAccountToken,
} from '../fixtures/create-test-app.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { createLogger } from '../../src/shared/observability/logger.js';

const url = 'postgresql://postgres:postgres@127.0.0.1:55432/agent_server_test';
const owner = {
  tenantId: 'h_faults',
  workspaceId: 'h_compat',
  principalType: 'service_account',
  principalId: 'h_worker',
  policySnapshotVersion: 'h-policy',
} as const;
const headers = {
  authorization: `Bearer ${primaryServiceAccountToken}`,
  'content-type': 'application/json',
};
const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out');
};

async function applyCurrentProvenanceMigration(pool: Pool): Promise<void> {
  await applyDurableKernelMigrations(pool);
  await pool.query(
    `DELETE FROM durable_kernel_schema_migrations WHERE version = '0010_runtime_memory_provenance'`,
  );
  await applyDurableKernelMigrations(pool, [
    resolveDurableKernelMigrationFilePath('0010_runtime_memory_provenance.sql'),
  ]);
}

describe('managed single-agent minimum fault evidence', () => {
  it('restarts dispatcher discovery without duplicating execution', async () => {
    const pool = new Pool({ connectionString: url, max: 4 });
    try {
      await applyCurrentProvenanceMigration(pool);
      const runs = new PostgresRunRepository(pool);
      const tasks = new PostgresTaskRepository(pool);
      const admissions = new PostgresAdmissionRepository(pool);
      const invokables = new PostgresInvokableRepository(pool);
      const admitted = await new AdmitRootTask(tasks, runs, admissions).execute(
        {
          prompt: 'restart evidence',
          idempotencyKey: crypto.randomUUID(),
          accessContext: owner,
        },
      );
      const runtime = new FakeAgentRuntime();
      const logger = createLogger({
        service: 'h-faults',
        minimumLevel: 'error',
        write: () => undefined,
      });
      const complete = new CompleteRun(runs, tasks);
      const team = new ExecuteTeamTask(
        tasks,
        runs,
        invokables,
        runtime,
        complete,
      );
      const execute = new ExecuteRun(
        complete,
        tasks,
        invokables,
        team,
        runtime,
        logger,
      );
      let available = true;
      const claim = {
        execute: async () => {
          if (!available) return null;
          available = false;
          return runs.claimQueuedById({
            runId: admitted.runId,
            workerId: 'h-restart',
            activationId: crypto.randomUUID(),
            claimedAt: new Date().toISOString(),
            leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
          });
        },
      } as unknown as ClaimNextRun;
      const first = new PostgresRunDispatcher(claim, execute, logger, {
        pollIntervalMs: 1,
      });
      first.start();
      await waitFor(
        async () =>
          (await runs.findById(admitted.runId))?.status === 'succeeded',
      );
      await first.stop();
      const second = new PostgresRunDispatcher(claim, execute, logger, {
        pollIntervalMs: 1,
      });
      second.start();
      await new Promise((r) => setTimeout(r, 25));
      await second.stop();
      expect(runtime.executeCalls).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('keeps the prior ready memory snapshot readable after a failed projection', async () => {
    const pool = new Pool({ connectionString: url, max: 2 });
    const projected = new Map<string, string>();
    let fail = false;
    const store = {
      publish: async (input: { snapshotId: string; memory: string }) => {
        if (fail) throw new Error('projection failed');
        projected.set(input.snapshotId, input.memory);
      },
      readVerified: async (input: { snapshotId: string }) =>
        projected.get(input.snapshotId)!,
    };
    try {
      await applyCurrentProvenanceMigration(pool);
      const memory = new ManagedMemory(pool, store);
      const scope = {
        tenantId: `h_memory_${crypto.randomUUID()}`,
        workspaceId: `h_workspace_${crypto.randomUUID()}`,
      };
      await pool.query(
        `INSERT INTO workspace_memory_owned_entries(entry_id,proposal_id,tenant_id,workspace_id,content,content_hash,category,proposer_snapshot,reviewer_snapshot,accepted_at) VALUES(gen_random_uuid(),gen_random_uuid(),$1,$2,'v1','hash','fact','{}','{}',now())`,
        [scope.tenantId, scope.workspaceId],
      );
      const first = await memory.rebuild(scope);
      fail = true;
      await expect(memory.rebuild(scope)).rejects.toThrow();
      const snapshots = await memory.listSnapshots(scope);
      expect(
        snapshots.find((s) => s.snapshotId === first.snapshotId)
          ?.projectionStatus,
      ).toBe('ready');
      expect(await store.readVerified({ snapshotId: first.snapshotId })).toBe(
        '## fact\n\nv1\n',
      );
    } finally {
      await pool.end();
    }
  });

  it('executes an admitted v1 task from its pinned version after v2 exists', async () => {
    const runtime = new FakeAgentRuntime();
    const app = await createTestApp(runtime, { startDispatcher: true });
    const source = `apiVersion: agent-server/v1alpha1\nkind: ManagedAgent\nmetadata:\n  name: v2\nspec:\n  description: v2\n  instructions: Use V2 only.\n  runtime:\n    provider: paseo\n    modelPolicyRef: free-only\n    mode: isolated\n  tools: []\n  skills: []\n  input:\n    schema: { type: object, additionalProperties: false, properties: {} }\n    prompt: input\n  session: { invocation: fresh_per_invocation, followUps: queued, binding: reusable }\n  memory: { policy: workspace_snapshot, proposalLimit: 1 }\n  permissions: { network: none, filesystem: none }\n  completion: { type: executable, command: done }`;
    const response = await app.request('/api/v1/tasks:invoke', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invokable: {
          kind: 'agent',
          version_id: defaultPublishedAgentVersionId,
        },
        input: { text: 'pinned' },
      }),
    });
    expect(response.status).toBe(202);
    await app.request('/api/v1/agents:import', {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ source }),
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(
      runtime.prompts.some((prompt) => prompt.includes('Do the task.')),
    ).toBe(true);
  });
});
