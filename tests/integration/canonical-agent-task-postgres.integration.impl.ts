import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { ClaimNextRun } from '../../src/application/runs/claim-next-run.js';
import { ExecuteRun } from '../../src/application/runs/execute-run.js';
import { GetTask } from '../../src/application/tasks/get-task.js';
import { ExecuteTeamTask } from '../../src/application/tasks/execute-team-task.js';
import { InvokeTask } from '../../src/application/tasks/invoke-task.js';
import { createAgentDefinition } from '../../src/domain/invokables/agent-definition.js';
import {
  createDraftAgentVersion,
  publishAgentVersion,
} from '../../src/domain/invokables/agent-version.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import { FakeAgentRuntime } from '../fixtures/fake-agent-runtime.js';
import { TestClock } from '../fixtures/test-clock.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error(
    'canonical agent task real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );
}

const primaryAccessContext = {
  tenantId: 'tenant_alpha',
  workspaceId: 'workspace_main',
  principalType: 'service_account' as const,
  principalId: 'svc_alpha',
  policySnapshotVersion: 'policy-2026-07-22',
};

describe('canonical agent task through the published agent version path', () => {
  it('executes a canonical agent task through the published agent version path', async () => {
    const schema = `canonical_agent_task_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({
      connectionString,
      max: 1,
    });
    const database = new Pool({
      connectionString,
      max: 1,
    });

    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await database.query(`SET search_path TO "${schema}", public`);

      const clock = new TestClock('2026-07-22T12:00:00.000Z');
      const runtime = new FakeAgentRuntime({
        responseText: 'AGENT_TASK_OK',
      });
      const logger = createLogger({
        service: 'agent-server-test',
        minimumLevel: 'error',
        write: () => undefined,
      });

      await applyDurableKernelMigrations(database);

      const invokables = new PostgresInvokableRepository(database);
      const createdAt = () => new Date('2026-07-22T12:00:00.000Z');
      const publishedAt = () => new Date('2026-07-22T12:05:00.000Z');
      const agentDefinition = createAgentDefinition({
        id: '00000000-0000-4000-8000-000000040001',
        tenantId: primaryAccessContext.tenantId,
        workspaceId: primaryAccessContext.workspaceId,
        principalType: primaryAccessContext.principalType,
        principalId: primaryAccessContext.principalId,
        name: 'Canonical Agent',
        description: 'Executes through the task path',
        now: createdAt,
      });
      const agentVersion = publishAgentVersion(
        createDraftAgentVersion({
          id: '00000000-0000-4000-8000-000000040101',
          definitionId: agentDefinition.id,
          tenantId: primaryAccessContext.tenantId,
          workspaceId: primaryAccessContext.workspaceId,
          principalType: primaryAccessContext.principalType,
          principalId: primaryAccessContext.principalId,
          name: 'Canonical Agent v1',
          description: 'Published agent',
          instructions: 'Reply with the analyzed result only.',
          now: createdAt,
        }),
        publishedAt,
      );
      await invokables.saveAgentDefinition(agentDefinition);
      await invokables.saveAgentVersion(agentVersion);

      const tasks = new PostgresTaskRepository(database);
      const runs = new PostgresRunRepository(database);
      const admissions = new PostgresAdmissionRepository(database);
      const invocation = await new InvokeTask(
        admissions,
        invokables,
        clock.now,
      ).execute({
        idempotencyKey: 'canonical-agent-task',
        invokable: { kind: 'agent', versionId: agentVersion.id },
        input: { text: 'Summarize this incident.' },
        accessContext: primaryAccessContext,
      });

      clock.advanceMs(30_000);
      const claim = await new ClaimNextRun(runs, {
        workerId: 'worker-agent-task',
        leaseDurationMs: 60_000,
        now: clock.now,
        activationIdFactory: () => '00000000-0000-4000-8000-000000000611',
      }).execute();

      expect(claim).not.toBeNull();

      await createExecuteRun({
        database,
        runRepository: runs,
        invokableRepository: invokables,
        runtime,
        logger,
        now: clock.now,
      }).execute(claim!);

      const task = await new GetTask(tasks).execute(
        invocation.task.task.id,
        primaryAccessContext,
      );

      expect(task).toMatchObject({
        task: {
          id: invocation.task.task.id,
          status: 'completed',
        },
        latestRun: {
          status: 'succeeded',
          result: { text: 'AGENT_TASK_OK' },
        },
      });
      expect(runtime.prompts).toHaveLength(1);
      expect(runtime.systemPrompts).toHaveLength(1);
      expect(runtime.systemPrompts[0]).toContain(
        'Reply with the analyzed result only.',
      );
      expect(runtime.prompts[0]).toContain('Summarize this incident.');
      expect(runtime.prompts[0]).not.toContain(
        'Reply with the analyzed result only.',
      );
    } finally {
      try {
        await database.end();
      } finally {
        try {
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await admin.end();
        }
      }
    }
  });
});

function createExecuteRun(input: {
  readonly database: Pool;
  readonly runRepository: PostgresRunRepository;
  readonly invokableRepository: PostgresInvokableRepository;
  readonly runtime: FakeAgentRuntime;
  readonly logger: ReturnType<typeof createLogger>;
  readonly now: () => Date;
}): ExecuteRun {
  const tasks = new PostgresTaskRepository(input.database);
  const completeRun = new CompleteRun(input.runRepository, tasks);
  const executeTeamTask = new ExecuteTeamTask(
    input.invokableRepository,
    {} as never,
  );

  return new ExecuteRun(
    completeRun,
    tasks,
    input.invokableRepository,
    executeTeamTask,
    input.runtime,
    input.logger,
    input.now,
  );
}
