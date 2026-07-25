import { describe, expect, it, vi } from 'vitest';

import { CompleteRun } from './complete-run.js';
import { RunCompletionConflictError } from '../ports/run-repository.js';
import { createRun, rehydrateRun, type Run } from '../../domain/runs/run.js';
import { createRootTask, transitionTask } from '../../domain/tasks/task.js';

describe('CompleteRun cancellation arbitration', () => {
  it.each([
    ['cancelled', ['cancelled'], 'cancelled'],
    ['succeeded', ['output', 'succeeded'], 'completed'],
    ['failed', ['failed'], 'failed'],
  ] as const)(
    'persists %s with the owned event sequence',
    async (status, eventTypes, taskStatus) => {
      const task = { ...activeTask(), sessionId: 'session', generation: 1 };
      const candidate = terminalRun(status);
      const order: string[] = [];
      let taskProjected = false;
      let laneAdvanced = false;
      let assistantProjected = false;
      const events = {
        append: vi.fn(async (_id: string, type: string) => {
          if (['succeeded', 'failed', 'cancelled'].includes(type)) {
            expect(taskProjected).toBe(true);
            expect(laneAdvanced).toBe(true);
            if (type === 'succeeded') expect(assistantProjected).toBe(true);
          }
          order.push(`event:${type}`);
          return { type };
        }),
      };
      const tasks = {
        findById: vi.fn(async () => task),
        save: vi.fn(async () => {
          taskProjected = true;
          order.push('task');
        }),
        advanceSessionLane: vi.fn(async () => {
          laneAdvanced = true;
          order.push('lane');
        }),
      };
      const sessions = {
        appendAssistantMessage: vi.fn(async () => {
          assistantProjected = true;
          order.push('assistant');
        }),
      };
      const repository = {
        completeClaimed: vi.fn(async () => {
          order.push('persist');
          return candidate;
        }),
      };
      const completed = await new CompleteRun(
        repository as never,
        tasks as never,
        events as never,
        sessions as never,
      ).execute({
        claim: claim(candidate, task.id),
        run: candidate,
      });

      expect(completed.status).toBe(status);
      expect(events.append.mock.calls.map((call) => call[1])).toEqual(
        eventTypes,
      );
      expect(tasks.save).toHaveBeenCalledTimes(1);
      expect(
        (
          tasks.save.mock.calls as unknown as Array<Array<{ status: string }>>
        )[0]?.[0]?.status,
      ).toBe(taskStatus);
      expect(sessions.appendAssistantMessage).toHaveBeenCalledTimes(
        status === 'succeeded' ? 1 : 0,
      );
      expect(order).toEqual(
        status === 'succeeded'
          ? [
              'persist',
              'task',
              'assistant',
              'lane',
              'event:output',
              'event:succeeded',
            ]
          : status === 'cancelled'
            ? ['persist', 'task', 'lane', 'event:cancelled']
            : ['persist', 'task', 'lane', 'event:failed'],
      );
    },
  );

  it('does not create terminal effects after a stale fencing conflict', async () => {
    const task = { ...activeTask(), sessionId: 'session', generation: 1 };
    const events = { append: vi.fn() };
    const tasks = {
      findById: vi.fn(async () => task),
      save: vi.fn(),
      advanceSessionLane: vi.fn(),
    };
    const sessions = { appendAssistantMessage: vi.fn() };
    const repository = {
      completeClaimed: vi.fn(async () => {
        throw new RunCompletionConflictError();
      }),
    };
    await expect(
      new CompleteRun(
        repository as never,
        tasks as never,
        events as never,
        sessions as never,
      ).execute({
        claim: claim(terminalRun('succeeded'), task.id),
        run: terminalRun('succeeded'),
      }),
    ).rejects.toBeInstanceOf(RunCompletionConflictError);
    expect(events.append).not.toHaveBeenCalled();
    expect(tasks.save).not.toHaveBeenCalled();
    expect(sessions.appendAssistantMessage).not.toHaveBeenCalled();
  });
});

function activeTask() {
  return transitionTask(
    createRootTask({
      id: '00000000-0000-4000-8000-000000000011',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'principal',
      policySnapshotVersion: 'policy',
      ingress: 'api',
      originRef: null,
      invokableKind: 'agent',
      invokableVersionId: '00000000-0000-4000-8000-000000000012',
      inputSnapshotRef: 'snapshot',
      inputFingerprint: 'fingerprint',
      now: () => new Date('2026-07-24T00:00:00.000Z'),
    }),
    'active',
    () => new Date('2026-07-24T00:00:01.000Z'),
  );
}

function terminalRun(status: Run['status']): Run {
  const queued = createRun('prompt', {
    id: '00000000-0000-4000-8000-000000000013',
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  return rehydrateRun({
    ...queued,
    status,
    updatedAt: '2026-07-24T00:00:02.000Z',
    ...(status === 'succeeded' ? { result: { text: 'done' } } : {}),
    ...(status === 'failed'
      ? { error: { code: 'runtime_execution_failed', message: 'failed' } }
      : {}),
    ...(status === 'cancelled'
      ? { error: { code: 'cancelled', message: 'The run was cancelled.' } }
      : {}),
  } as Run);
}

function claim(run: Run, taskId: string) {
  return {
    run,
    taskId,
    attempt: 1,
    workerId: 'worker',
    activationId: '00000000-0000-4000-8000-000000000014',
    fencingToken: 1,
    leaseExpiresAt: '2026-07-24T00:01:00.000Z',
  };
}
