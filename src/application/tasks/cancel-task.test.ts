import { describe, expect, it, vi } from 'vitest';

import type { AccessContext } from '../../platform/access-context.js';
import { CancelTask } from './cancel-task.js';
import { createRun, rehydrateRun, type Run } from '../../domain/runs/run.js';
import { createRootTask, type Task } from '../../domain/tasks/task.js';

const owner: AccessContext = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account',
  principalId: 'principal',
  policySnapshotVersion: 'policy',
};

describe('CancelTask', () => {
  it.each([
    ['queued_cancelled', 'cancelled'],
    ['running_requested', 'cancellation_requested'],
    ['running_already_requested', 'cancellation_requested'],
    ['terminal', 'terminal'],
  ] as const)(
    'maps %s without duplicate side effects',
    async (outcome, status) => {
      const task = fixtureTask();
      const run = fixtureRun(
        outcome === 'queued_cancelled'
          ? 'queued'
          : outcome.startsWith('running')
            ? 'running'
            : 'succeeded',
      );
      const order: string[] = [];
      const executions = { cancel: vi.fn(async (_runId: string) => undefined) };
      const events = {
        append: vi.fn(async () => {
          order.push('event');
        }),
      };
      const runs = {
        findByTaskId: vi.fn(async () => run),
        requestCancellation: vi.fn(async () => ({ runId: run.id, outcome })),
      };
      const tasks = {
        findByIdForOwner: vi.fn(async () => ({ task, latestRun: null })),
        save: vi.fn(async () => {
          order.push('task');
        }),
        advanceSessionLane: vi.fn(async () => {
          order.push('lane');
        }),
      };

      const result = await new CancelTask(
        tasks as never,
        runs as never,
        executions,
        events as never,
      ).execute(task.id, owner);

      expect(result).toMatchObject({ taskId: task.id, runId: run.id, status });
      expect(executions.cancel).toHaveBeenCalledTimes(
        outcome === 'running_requested' ? 1 : 0,
      );
      expect(tasks.save).toHaveBeenCalledTimes(
        outcome === 'queued_cancelled' ? 1 : 0,
      );
      expect(tasks.advanceSessionLane).toHaveBeenCalledTimes(
        outcome === 'queued_cancelled' ? 1 : 0,
      );
      expect(events.append).toHaveBeenCalledTimes(
        outcome === 'queued_cancelled' ? 1 : 0,
      );
      expect(order).toEqual(
        outcome === 'queued_cancelled' ? ['task', 'lane', 'event'] : [],
      );
    },
  );

  it('returns null when owner or run arbitration cannot find the task', async () => {
    const runs = {
      findByTaskId: vi.fn(async () => null),
      requestCancellation: vi.fn(),
    };
    const tasks = { findByIdForOwner: vi.fn(async () => null) };
    const result = await new CancelTask(
      tasks as never,
      runs as never,
      { cancel: vi.fn(async () => undefined) },
    ).execute('missing', owner);
    expect(result).toBeNull();
    expect(runs.requestCancellation).not.toHaveBeenCalled();
  });

  it('uses the authoritative run id returned by arbitration', async () => {
    const task = fixtureTask();
    const staleRun = fixtureRun('running');
    const executions = { cancel: vi.fn(async (_runId: string) => undefined) };
    const runs = {
      findByTaskId: vi.fn(async () => staleRun),
      requestCancellation: vi.fn(async () => ({
        runId: 'authoritative-run',
        outcome: 'running_requested' as const,
      })),
    };
    const result = await new CancelTask(
      {
        findByIdForOwner: vi.fn(async () => ({ task, latestRun: null })),
      } as never,
      runs as never,
      executions,
    ).execute(task.id, owner);
    expect(result?.runId).toBe('authoritative-run');
    expect(executions.cancel).toHaveBeenCalledWith('authoritative-run');
  });
});

function fixtureTask(): Task {
  return createRootTask({
    id: '00000000-0000-4000-8000-000000000001',
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    principalType: owner.principalType,
    principalId: owner.principalId,
    policySnapshotVersion: owner.policySnapshotVersion,
    ingress: 'api',
    originRef: null,
    invokableKind: 'agent',
    invokableVersionId: '00000000-0000-4000-8000-000000000002',
    inputSnapshotRef: 'snapshot',
    inputFingerprint: 'fingerprint',
    now: () => new Date('2020-01-01T00:00:00.000Z'),
  });
}

function fixtureRun(status: Run['status']): Run {
  const queued = createRun('prompt', {
    id: '00000000-0000-4000-8000-000000000003',
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  if (status === 'queued') return queued;
  return rehydrateRun({
    ...queued,
    status,
    updatedAt: '2026-07-24T00:00:01.000Z',
    ...(status === 'succeeded' ? { result: { text: 'done' } } : {}),
  } as Run);
}
