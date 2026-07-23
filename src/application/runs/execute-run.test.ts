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
import { ExecuteTeamTask } from '../tasks/execute-team-task.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../tasks/root-task-input.js';
import { CompleteRun } from './complete-run.js';
import { ExecuteRun } from './execute-run.js';
import { createRuntimeExecutionReceipt } from './runtime-execution-receipt.js';

describe('ExecuteRun', () => {
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

function createTask(invokableKind: 'agent' | 'team' = 'agent'): Task {
  return createRootTask({
    id: 'task-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'user',
    principalId: 'user-1',
    policySnapshotVersion: 'policy-1',
    ingress: 'api',
    invokableKind,
    invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
    inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
      prompt: 'private prompt',
    }),
    inputFingerprint: 'fingerprint-1',
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
