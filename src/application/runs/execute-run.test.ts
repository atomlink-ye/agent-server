import { describe, expect, it, vi } from 'vitest';

import { createRun, transitionRun, type Run } from '../../domain/runs/run.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { createRootTask, type Task } from '../../domain/tasks/task.js';
import type { AgentRuntimePort } from '../ports/agent-runtime.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import type { ClaimedRun } from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { CompleteRun } from './complete-run.js';
import { ExecuteRun } from './execute-run.js';

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
});

function createExecuteRun(input: {
  readonly completeRun: CompleteRun;
  readonly runtime: AgentRuntimePort;
  readonly task: Task;
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

function createTask(): Task {
  return createRootTask({
    id: 'task-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'user',
    principalId: 'user-1',
    policySnapshotVersion: 'policy-1',
    ingress: 'api',
    invokableKind: 'agent',
    invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
    inputSnapshotRef: 'snapshot-1',
    inputFingerprint: 'fingerprint-1',
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
}
