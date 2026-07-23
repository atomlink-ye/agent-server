import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccessContext } from '../../src/application/control-plane/access-context.js';
import { GetTask } from '../../src/application/tasks/get-task.js';
import { InvokeTask } from '../../src/application/tasks/invoke-task.js';
import { createAgentDefinition } from '../../src/domain/invokables/agent-definition.js';
import {
  createDraftAgentVersion,
  publishAgentVersion,
} from '../../src/domain/invokables/agent-version.js';
import {
  applyDurableKernelMigrations,
  createPostgresPool,
} from '../../src/infrastructure/postgres/postgres.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const required = process.env.REAL_POSTGRES_REQUIRED === '1';

if (required && !connectionString) {
  throw new Error(
    'REAL_POSTGRES_REQUIRED=1 requires DATABASE_URL or POSTGRES_URL for the real PostgreSQL integration lane',
  );
}

const describeRealPostgres = connectionString ? describe : describe.skip;

const owner: AccessContext = {
  tenantId: 'real_pg_admission_test',
  workspaceId: 'real_pg_workspace',
  principalType: 'service_account',
  principalId: 'real_pg_owner',
  policySnapshotVersion: 'real-pg-policy-v1',
};
const agentDefinitionId = '00000000-0000-4000-8000-0000000a1001';
const agentVersionId = '00000000-0000-4000-8000-0000000a1101';

describeRealPostgres('real PostgreSQL admission pool', () => {
  const pool = connectionString
    ? createPostgresPool({ connectionString, maxConnections: 2 })
    : null;
  const readerPool = connectionString
    ? createPostgresPool({ connectionString, maxConnections: 2 })
    : null;
  const invoke = pool
    ? new InvokeTask(
        new PostgresAdmissionRepository(pool),
        // Keep the pre-admission published-version lookup off the two
        // transaction connections used by the admission pool.
        new PostgresInvokableRepository(readerPool!),
        () => new Date('2026-07-23T12:00:00.000Z'),
      )
    : null;

  beforeAll(async () => {
    if (!pool) return;

    await applyDurableKernelMigrations(pool);
    await cleanTestRows(pool);

    const definition = createAgentDefinition({
      id: agentDefinitionId,
      ...owner,
      name: 'Real PostgreSQL admission agent',
      description: 'Admission integration fixture',
      now: () => new Date('2026-07-23T11:00:00.000Z'),
    });
    const version = publishAgentVersion(
      createDraftAgentVersion({
        id: agentVersionId,
        definitionId: definition.id,
        ...owner,
        name: 'Real PostgreSQL admission agent v1',
        description: 'Published admission integration fixture',
        instructions: 'Return the input unchanged.',
        now: () => new Date('2026-07-23T11:00:00.000Z'),
      }),
      () => new Date('2026-07-23T11:05:00.000Z'),
    );
    const invokables = new PostgresInvokableRepository(pool);
    await invokables.saveAgentDefinition(definition);
    await invokables.saveAgentVersion(version);
  });

  afterAll(async () => {
    await Promise.all([pool?.end(), readerPool?.end()]);
  });

  it('commits an invocation and reloads the task and run through a separate pool connection', async () => {
    const result = await invoke!.execute({
      idempotencyKey: 'real-pg-first-invocation',
      invokable: { kind: 'agent', versionId: agentVersionId },
      input: { text: 'first real postgres prompt' },
      accessContext: owner,
    });

    expect(result.reused).toBe(false);
    const loaded = await new GetTask(
      new PostgresTaskRepository(readerPool!),
    ).execute(result.task.task.id, owner);

    expect(loaded).toMatchObject({
      task: {
        id: result.task.task.id,
        tenantId: owner.tenantId,
        workspaceId: owner.workspaceId,
        principalId: owner.principalId,
      },
      latestRun: {
        runId: result.task.latestRun?.runId,
        status: 'queued',
      },
    });
  });

  it('replays the same canonical task and run for the same key and body', async () => {
    const request = {
      idempotencyKey: 'real-pg-replay',
      invokable: { kind: 'agent' as const, versionId: agentVersionId },
      input: { text: 'replayable real postgres prompt' },
      accessContext: owner,
    };
    const first = await invoke!.execute(request);
    const replay = await invoke!.execute(request);

    expect(first.reused).toBe(false);
    expect(replay.reused).toBe(true);
    expect(replay.task.task.id).toBe(first.task.task.id);
    expect(replay.task.latestRun?.runId).toBe(first.task.latestRun?.runId);
  });

  it('settles concurrent same-key calls to one committed task and run without rollback leakage', async () => {
    const concurrentInvoke = new InvokeTask(
      new PostgresAdmissionRepository(pool!),
      new BarrierInvokableRepository(readerPool!, createTwoPartyBarrier()),
      () => new Date('2026-07-23T12:00:00.000Z'),
    );
    const request = {
      idempotencyKey: 'real-pg-concurrent',
      invokable: { kind: 'agent' as const, versionId: agentVersionId },
      input: { text: 'concurrent real postgres prompt' },
      accessContext: owner,
    };
    const results = await Promise.all(
      Array.from({ length: 2 }, () => concurrentInvoke.execute(request)),
    );
    const taskIds = new Set(results.map((result) => result.task.task.id));
    const runIds = new Set(
      results.map((result) => result.task.latestRun?.runId),
    );

    expect(taskIds.size).toBe(1);
    expect(runIds.size).toBe(1);
    expect(results.map((result) => result.reused).sort()).toEqual([
      false,
      true,
    ]);

    const rows = await readerPool!.query<{
      task_count: string;
      run_count: string;
    }>(
      `
        SELECT
          (SELECT count(*) FROM tasks WHERE tenant_id = $1 AND input_fingerprint = $2) AS task_count,
          (SELECT count(*) FROM runs WHERE task_id = $3) AS run_count
      `,
      [
        owner.tenantId,
        results[0]!.task.task.inputFingerprint,
        results[0]!.task.task.id,
      ],
    );
    expect(rows.rows?.[0]).toEqual({ task_count: '1', run_count: '1' });
  });

  it('does not expose the committed task to another owner scope', async () => {
    const result = await invoke!.execute({
      idempotencyKey: 'real-pg-owner-scope',
      invokable: { kind: 'agent', versionId: agentVersionId },
      input: { text: 'owner scoped prompt' },
      accessContext: owner,
    });

    await expect(
      new GetTask(new PostgresTaskRepository(readerPool!)).execute(
        result.task.task.id,
        { ...owner, principalId: 'real_pg_other_owner' },
      ),
    ).resolves.toBeNull();
  });
});

class BarrierInvokableRepository extends PostgresInvokableRepository {
  public constructor(
    database: ConstructorParameters<typeof PostgresInvokableRepository>[0],
    private readonly arrive: () => Promise<void>,
  ) {
    super(database);
  }

  public override async findPublishedAgentVersionById(
    ...args: Parameters<
      PostgresInvokableRepository['findPublishedAgentVersionById']
    >
  ) {
    const version = await super.findPublishedAgentVersionById(...args);
    await this.arrive();
    return version;
  }
}

function createTwoPartyBarrier(): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === 2) {
      release();
    }
    await released;
  };
}

async function cleanTestRows(
  pool: ReturnType<typeof createPostgresPool>,
): Promise<void> {
  await pool.query(
    `
      DELETE FROM run_dispatches
      WHERE run_id IN (
        SELECT runs.id FROM runs INNER JOIN tasks ON tasks.id = runs.task_id
        WHERE tasks.tenant_id = $1
      )
    `,
    [owner.tenantId],
  );
  await pool.query('DELETE FROM admissions WHERE tenant_id = $1', [
    owner.tenantId,
  ]);
  await pool.query(
    `DELETE FROM runs USING tasks WHERE runs.task_id = tasks.id AND tasks.tenant_id = $1`,
    [owner.tenantId],
  );
  await pool.query('DELETE FROM tasks WHERE tenant_id = $1', [owner.tenantId]);
  await pool.query('DELETE FROM agent_versions WHERE tenant_id = $1', [
    owner.tenantId,
  ]);
  await pool.query('DELETE FROM agent_definitions WHERE tenant_id = $1', [
    owner.tenantId,
  ]);
}
