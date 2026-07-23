import { describe, expect, it, vi } from 'vitest';

import { createRun, transitionRun, type Run } from '../../domain/runs/run.js';
import type { CompiledSequentialTeamPlan } from '../../domain/invokables/compiled-team-plan.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { createRootTask, type Task } from '../../domain/tasks/task.js';
import type { AgentRuntimePort } from '../ports/agent-runtime.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import type { ClaimedRun } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { Logger } from '../../shared/observability/logger.js';
import { ResolveAgentVersion } from '../agents/resolve-agent-version.js';
import { ExecuteTeamTask } from '../tasks/execute-team-task.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../tasks/root-task-input.js';
import { CompleteRun } from './complete-run.js';
import { ExecuteRun } from './execute-run.js';
import type { CreateMemoryProposal } from '../memory/create-memory-proposal.js';
import { createRuntimeExecutionReceipt } from './runtime-execution-receipt.js';

describe('ExecuteRun', () => {
  it('resolves a published managed Agent with durable Task ownership and sends only its instructions', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'managed-version-1');
    const findVersion = vi.fn(async () => ({
      id: 'managed-version-1',
      status: 'published',
      package: { spec: { instructions: 'managed instructions' } },
    })) as never;
    const findLegacy = vi.fn(async () => null);
    const resolver = new ResolveAgentVersion(
      { findVersion },
      { findPublishedAgentVersionById: findLegacy },
    );
    const runtime = createRuntime();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
    });

    await executeRun.execute(claim);

    expect(findVersion).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        principalType: 'user',
        principalId: 'user-1',
      },
      'managed-version-1',
    );
    expect(findLegacy).not.toHaveBeenCalled();
    expect(runtime.execute).toHaveBeenCalledTimes(1);
    expect(runtime.execute).toHaveBeenCalledWith({
      runId: claim.run.id,
      prompt:
        'Runtime contract: execute the supplied task input using the published agent instructions. Do not infer or access other session history.\n\nPublished AgentVersion instructions:\nmanaged instructions\n\nCurrent Task input:\nprivate prompt',
    });
    expect(
      JSON.stringify(vi.mocked(runtime.execute).mock.calls[0]?.[0]),
    ).not.toMatch(/package|modelPolicyRef|schema|template|completion|tools/);
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
  });

  it('succeeds without persisting runtime candidates for a direct Task with no source Message', async () => {
    const claim = createClaim();
    const task = createTask(
      'agent',
      'managed-version-1',
      'task-without-message',
      null,
    );
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'managed instructions',
              memory: { proposalLimit: 1 },
            },
          },
        })) as never,
      },
      { findPublishedAgentVersionById: vi.fn(async () => null) },
    );
    const runtime = createRuntimeWithCandidates();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const batch = vi.fn(async () => undefined);

    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
      createMemoryProposal: { executeBatch: batch } as never,
    });

    const completed = await executeRun.execute(claim);

    expect(completed.status).toBe('succeeded');
    expect(runtime.execute).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the shared resolver returns null without a legacy lookup in ExecuteRun', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'draft-or-foreign-version');
    const findVersion = vi.fn(async () => ({
      id: 'draft-or-foreign-version',
      status: 'draft',
      package: { spec: { instructions: 'not executable' } },
    })) as never;
    const findLegacy = vi.fn(async () => ({
      id: 'draft-or-foreign-version',
      instructions: 'legacy must not be consulted by ExecuteRun',
    })) as never;
    const resolver = new ResolveAgentVersion(
      { findVersion },
      { findPublishedAgentVersionById: findLegacy },
    );
    const runtime = createRuntime();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
    });

    const completed = await executeRun.execute(claim);

    expect(completed.status).toBe('failed');
    expect(completed.error?.code).toBe('runtime_execution_failed');
    expect(runtime.execute).not.toHaveBeenCalled();
    expect(findLegacy).not.toHaveBeenCalled();
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves the legacy fallback prompt shape through the shared resolver', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'legacy-version-1');
    const runtime = createRuntime();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const resolver = new ResolveAgentVersion(
      { findVersion: vi.fn(async () => null) },
      {
        findPublishedAgentVersionById: vi.fn(async () => ({
          id: 'legacy-version-1',
          instructions: 'legacy instructions',
        })) as never,
      },
    );
    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
    });

    await executeRun.execute(claim);

    expect(runtime.execute).toHaveBeenCalledWith({
      runId: claim.run.id,
      prompt:
        'Runtime contract: execute the supplied task input using the published agent instructions. Do not infer or access other session history.\n\nPublished AgentVersion instructions:\nlegacy instructions\n\nCurrent Task input:\nprivate prompt',
    });
  });

  it('reports persistence failure with a receipt after runtime success', async () => {
    const claim = createClaim();
    const task = createTask();
    const completeRun = {
      execute: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as CompleteRun;
    const runtime = createRuntime();
    const executeRun = createExecuteRun({ completeRun, runtime, task });

    await expect(executeRun.execute(claim)).rejects.toMatchObject({
      name: 'RunCompletionPersistenceError',
      code: 'terminal_persistence_failed',
      receipt: {
        runId: claim.run.id,
        taskId: claim.taskId,
        terminalStatus: 'succeeded',
        provider: 'test-provider',
        model: 'test-model',
        resultAvailable: true,
        resultFingerprint: expect.any(String),
      },
    });
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
    expect(completeRun.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          status: 'failed',
          error: { code: 'runtime_execution_failed' },
        }),
      }),
    );
  });

  it('completes a failed Run when runtime execution throws', async () => {
    const claim = createClaim();
    const task = createTask();
    const failedRun = {
      ...claim.run,
      status: 'failed',
      error: {
        code: 'runtime_execution_failed',
        message: 'The runtime could not complete the run.',
      },
    } as Run;
    const completeRun = {
      execute: vi.fn(async () => failedRun),
    } as unknown as CompleteRun;
    const runtime = createRuntime(new Error('runtime exploded'));
    const executeRun = createExecuteRun({ completeRun, runtime, task });

    await expect(executeRun.execute(claim)).resolves.toBe(failedRun);
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
    const firstCall = (
      completeRun.execute as unknown as {
        mock: { calls: Array<Array<{ run: Run }>> };
      }
    ).mock.calls[0];
    expect(firstCall?.[0]?.run).toMatchObject({
      status: 'failed',
      error: { code: 'runtime_execution_failed' },
    });
  });

  it('does not retry completion or report persistence failure when terminal logging fails', async () => {
    const claim = createClaim();
    const task = createTask();
    const succeededRun = transitionRun(
      claim.run,
      'succeeded',
      {
        runtime: { provider: 'test-provider', model: 'test-model' },
        result: { text: 'safe result' },
      },
      () => new Date('2026-07-23T00:00:00.000Z'),
    );
    const completeRun = {
      execute: vi.fn().mockResolvedValueOnce(succeededRun),
    } as unknown as CompleteRun;
    const loggerFailure = new Error('logger unavailable');
    const logger = {
      log: vi.fn((_level: string, event: string) => {
        if (event === 'run.succeeded') throw loggerFailure;
      }),
    };
    const executeRun = createExecuteRun({
      completeRun,
      runtime: createRuntime(),
      task,
      logger,
    });

    await expect(executeRun.execute(claim)).rejects.toBe(loggerFailure);
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalledWith(
      'error',
      'run.completion_persistence_failed',
      expect.anything(),
    );
  });

  it('preserves a failed child outcome when child completion persistence throws', async () => {
    const claim = createClaim();
    const task = createTask('team');
    let savedChildRun: Run | undefined;
    let savedChildTaskId: string | undefined;
    const tasks = {
      findById: vi.fn(async (id: string) =>
        id === task.id ? task : undefined,
      ),
      save: vi.fn(async (savedTask: Task) => {
        if (savedTask.parentTaskId) savedChildTaskId = savedTask.id;
      }),
    } as unknown as TaskRepository;
    const completeRun = {
      execute: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as CompleteRun;
    const runtime = createRuntime(new Error('child runtime exploded'));
    const teamTask = new ExecuteTeamTask(
      tasks,
      {
        save: vi.fn(async (run: Run, options?: { taskId?: string }) => {
          savedChildRun = run;
          savedChildTaskId = options?.taskId;
        }),
        claimQueuedById: vi.fn(async () => {
          if (!savedChildRun) return null;
          return {
            ...claim,
            taskId: savedChildTaskId ?? claim.taskId,
            run: transitionRun(
              savedChildRun,
              'running',
              {},
              () => new Date('2026-07-23T00:00:00.000Z'),
            ),
          };
        }),
      } as never,
      {
        findPublishedTeamVersionById: vi.fn(async () => ({
          compiledPlan: createTeamPlan(),
        })),
        findPublishedAgentVersionById: vi.fn(async () => ({
          id: 'agent-version-1',
          instructions: 'Be safe.',
        })),
      } as never,
      runtime,
      completeRun,
      () => new Date('2026-07-23T00:00:00.000Z'),
    );
    const logger = { log: vi.fn() };
    const executeRun = new ExecuteRun(
      completeRun,
      tasks,
      {} as InvokableRepository,
      teamTask,
      runtime,
      logger,
      () => new Date('2026-07-23T00:00:00.000Z'),
    );

    const rejection = executeRun
      .execute(claim)
      .catch((error: unknown) => error);
    await expect(rejection).resolves.toMatchObject({
      name: 'RunCompletionPersistenceError',
      receipt: {
        runId: expect.any(String),
        taskId: expect.any(String),
        terminalStatus: 'failed',
      },
    });
    const error = (await rejection) as {
      readonly receipt: { readonly runId: string; readonly taskId?: string };
    };
    const childCall = (
      completeRun.execute as unknown as {
        mock: { calls: Array<Array<{ run: Run }>> };
      }
    ).mock.calls[0];
    expect(error.receipt.runId).toBe(childCall?.[0]?.run.id);
    expect(error.receipt.runId).not.toBe(claim.run.id);
    expect(error.receipt.taskId).toEqual(expect.any(String));
    expect(error.receipt.taskId).not.toBe(claim.taskId);
    expect(runtime.execute).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runtime.execute).mock.calls[0]?.[0]?.runId).not.toBe(
      claim.run.id,
    );
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
    expect(completeRun.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(logger.log).toHaveBeenCalledTimes(2);
    expect(
      logger.log.mock.calls.filter(
        (call: unknown[]) => call[1] === 'run.completion_persistence_failed',
      ),
    ).toHaveLength(1);
    expect(logger.log).toHaveBeenCalledWith(
      'error',
      'run.completion_persistence_failed',
      expect.objectContaining({ terminal_status: 'failed' }),
    );
  });

  it('rejects a receipt for a nonterminal run status', () => {
    const claim = createClaim();

    expect(() => createRuntimeExecutionReceipt(claim.run)).toThrow(
      'Cannot create runtime execution receipt for running run',
    );
  });

  it('raises typed recoverable persistence failure for runtime memory candidates', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'managed-version-1');
    const runtime = createRuntimeWithCandidates();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'instructions',
              memory: { proposalLimit: 1 },
            },
          },
        })) as never,
      },
      { findPublishedAgentVersionById: vi.fn(async () => null) },
    );
    const createMemoryProposal = {
      execute: vi.fn(async () => {
        throw new Error('control plane down');
      }),
    } as never;
    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
      createMemoryProposal,
    });

    await expect(executeRun.execute(claim)).rejects.toMatchObject({
      name: 'RuntimeMemoryPersistenceError',
      code: 'runtime_memory_persistence_failed',
    });
    expect(completeRun.execute).not.toHaveBeenCalled();
  });

  it('applies immutable proposal limit and rejects secret-like runtime candidates', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'managed-version-1');
    const runtime = {
      ...createRuntime(),
      execute: vi.fn(async () => ({
        provider: 'test-provider',
        model: 'test-model',
        text: 'safe result',
        memoryCandidates: [
          { category: 'project_constraint', content: 'api_key=secret' },
          { category: 'project_constraint', content: 'safe constraint' },
          { category: 'project_constraint', content: 'over limit candidate' },
        ],
      })),
    } as AgentRuntimePort;
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const batch = vi.fn(
      async (inputs: readonly { content: string }[]) => inputs as never,
    );
    const createMemoryProposal = {
      execute: vi.fn(),
      executeBatch: batch,
    } as unknown as CreateMemoryProposal;
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'instructions',
              memory: { proposalLimit: 2 },
            },
          },
        })) as never,
      },
      { findPublishedAgentVersionById: vi.fn(async () => null) },
    );
    await new ExecuteRun(
      completeRun,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
      {} as never,
      {} as never,
      runtime,
      { log: vi.fn() },
      () => new Date(),
      resolver,
      undefined,
      undefined,
      createMemoryProposal,
    ).execute(claim);
    expect(batch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: 'safe constraint' }),
      ]),
    );
    expect(batch.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('keeps proposal limits execution-local across concurrent managed and compatibility runs', async () => {
    const lowTask = createTask('agent', 'managed-low', 'task-low');
    const highTask = createTask('agent', 'managed-high', 'task-high');
    const compatibilityTask = createTask(
      'agent',
      RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      'task-compat',
    );
    const tasksById = new Map([
      ['task-low', lowTask],
      ['task-high', highTask],
      ['task-compat', compatibilityTask],
    ]);
    const claims = [
      createClaimWithIds('run-low', 'task-low'),
      createClaimWithIds('run-high', 'task-high'),
      createClaimWithIds('run-compat', 'task-compat'),
    ];
    const runtime = {
      ...createRuntime(),
      execute: vi.fn(async ({ runId }: { runId: string }) => {
        await new Promise((resolve) =>
          setTimeout(resolve, runId === 'run-low' ? 10 : 0),
        );
        return {
          provider: 'test-provider',
          model: 'test-model',
          text: runId,
          memoryCandidates: [
            { category: 'project_constraint', content: 'one' },
            { category: 'project_constraint', content: 'two' },
            { category: 'project_constraint', content: 'three' },
          ],
        };
      }),
    } as AgentRuntimePort;
    const batch = vi.fn(
      async (inputs: readonly { content: string }[]) => inputs as never,
    );
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async (_scope, id: string) => ({
          id,
          status: 'published',
          package: {
            spec: {
              instructions: 'instructions',
              memory: { proposalLimit: id === 'managed-low' ? 1 : 3 },
            },
          },
        })) as never,
      },
      { findPublishedAgentVersionById: vi.fn(async () => null) },
    );
    const executeRun = new ExecuteRun(
      { execute: vi.fn(async ({ run }: { run: Run }) => run) } as never,
      {
        findById: vi.fn(async (id: string) => tasksById.get(id) ?? null),
        save: vi.fn(),
      } as never,
      {} as never,
      {} as never,
      runtime,
      { log: vi.fn() },
      () => new Date(),
      resolver,
      undefined,
      undefined,
      { executeBatch: batch } as never,
    );

    await Promise.all([
      executeRun.execute(claims[0]!),
      executeRun.execute(claims[1]!),
    ]);
    expect(runtime.execute).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls.map(([inputs]) => inputs.length).sort()).toEqual([
      1, 3,
    ]);

    await executeRun.execute(claims[2]!);
    expect(batch).toHaveBeenCalledTimes(2);
  });
});

function createExecuteRun(input: {
  readonly completeRun: CompleteRun;
  readonly runtime: AgentRuntimePort;
  readonly task: Task;
  readonly logger?: Logger;
}): ExecuteRun {
  const tasks = {
    findById: vi.fn(async () => input.task),
    save: vi.fn(async () => undefined),
  } as unknown as TaskRepository;
  return new ExecuteRun(
    input.completeRun,
    tasks,
    {} as InvokableRepository,
    {} as never,
    input.runtime,
    input.logger ?? { log: vi.fn() },
    () => new Date('2026-07-23T00:00:00.000Z'),
  );
}

function createDirectExecuteRun(input: {
  readonly completeRun: CompleteRun;
  readonly runtime: AgentRuntimePort;
  readonly task: Task;
  readonly resolver: ResolveAgentVersion;
  readonly createMemoryProposal?: CreateMemoryProposal;
}): ExecuteRun {
  const tasks = {
    findById: vi.fn(async () => input.task),
    save: vi.fn(async () => undefined),
  } as unknown as TaskRepository;
  return new ExecuteRun(
    input.completeRun,
    tasks,
    {} as InvokableRepository,
    {} as never,
    input.runtime,
    { log: vi.fn() },
    () => new Date('2026-07-23T00:00:00.000Z'),
    input.resolver,
    undefined,
    undefined,
    input.createMemoryProposal,
  );
}

function createRuntimeWithCandidates(): AgentRuntimePort {
  return {
    ...createRuntime(),
    execute: vi.fn(async () => ({
      provider: 'test-provider',
      model: 'test-model',
      text: 'safe result',
      memoryCandidates: [
        { category: 'project_constraint', content: 'keep logs' },
      ],
    })),
  };
}

function createRuntime(error?: Error): AgentRuntimePort {
  return {
    initialize: vi.fn(async () => undefined),
    health: vi.fn(async () => ({
      ready: true,
      provider: 'test-provider',
      model: 'test-model',
      checks: [],
    })),
    execute: vi.fn(async () => {
      if (error) throw error;
      return {
        provider: 'test-provider',
        model: 'test-model',
        text: 'safe result',
      };
    }),
    close: vi.fn(async () => undefined),
  };
}

function createClaim(): ClaimedRun {
  const queuedRun = createRun('private prompt', {
    id: 'run-1',
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
  const run = transitionRun(
    queuedRun,
    'running',
    {},
    () => new Date('2026-07-23T00:00:00.000Z'),
  );
  return {
    run,
    taskId: 'task-1',
    attempt: 1,
    workerId: 'worker-1',
    activationId: 'activation-1',
    fencingToken: 1,
    leaseExpiresAt: '2026-07-23T01:00:00.000Z',
  };
}

function createClaimWithIds(runId: string, taskId: string): ClaimedRun {
  const queuedRun = createRun('private prompt', {
    id: runId,
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
  return {
    run: transitionRun(
      queuedRun,
      'running',
      {},
      () => new Date('2026-07-23T00:00:00.000Z'),
    ),
    taskId,
    attempt: 1,
    workerId: 'worker-1',
    activationId: `activation-${runId}`,
    fencingToken: 1,
    leaseExpiresAt: '2026-07-23T01:00:00.000Z',
  };
}

function createTask(
  invokableKind: 'agent' | 'team' = 'agent',
  invokableVersionId = RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
  id = 'task-1',
  sourceMessageId: string | null = `message-${id}`,
): Task {
  return createRootTask({
    id,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'user',
    principalId: 'user-1',
    policySnapshotVersion: 'policy-1',
    ingress: 'api',
    invokableKind,
    invokableVersionId,
    inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
      prompt: 'private prompt',
    }),
    inputFingerprint: 'fingerprint-1',
    sourceMessageId,
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
}

function createTeamPlan(): CompiledSequentialTeamPlan {
  return {
    compilerVersion: 'sequential-mvp-v1',
    teamVersionId: 'team-version-1',
    entryNodeId: 'step-1',
    finalOutputNodeId: 'step-1',
    compiledAt: '2026-07-23T00:00:00.000Z',
    steps: [
      {
        nodeId: 'step-1',
        nodePath: 'step-1',
        agentVersionId: 'agent-version-1',
        order: 1,
        output: 'final',
      },
    ],
  };
}
