import { describe, expect, it, vi } from 'vitest';

import type { Task } from '../../domain/tasks/task.js';
import { RunTeamCoordinator } from './run-team-coordinator.js';

describe('RunTeamCoordinator', () => {
  it('serializes turns for the same Team member without globally serializing other members', async () => {
    const coordinator = new RunTeamCoordinator({} as never, {} as never);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = coordinator.runExclusive('member-1', async () => {
      order.push('member-1:first:start');
      await firstGate;
      order.push('member-1:first:end');
    });
    await Promise.resolve();

    const second = coordinator.runExclusive('member-1', async () => {
      order.push('member-1:second:start');
    });
    const independent = coordinator.runExclusive('member-2', async () => {
      order.push('member-2:start');
    });
    await independent;

    expect(order).toEqual(['member-1:first:start', 'member-2:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual([
      'member-1:first:start',
      'member-2:start',
      'member-1:first:end',
      'member-1:second:start',
    ]);
  });

  it('keeps Team member identity validation at the coordination boundary', async () => {
    const executions = {
      findMemberRunById: vi.fn(async () => ({
        id: 'member-1',
        teamRunId: 'team-1',
        role: 'member',
        agentVersionId: 'agent-version-1',
      })),
      findTeamRunByRootTaskId: vi.fn(async () => ({
        id: 'team-1',
        rootTaskId: 'root-task-1',
      })),
    };
    const coordinator = new RunTeamCoordinator(
      executions as never,
      {} as never,
    );
    const invalidLeadTask = {
      teamTaskKind: 'lead_turn',
      teamMemberRunId: 'member-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
      rootTaskId: 'root-task-1',
      invokableVersionId: 'agent-version-1',
    } as Task;

    await expect(coordinator.resolve(invalidLeadTask)).rejects.toThrow(
      'Team member task identity is invalid.',
    );
  });
});
