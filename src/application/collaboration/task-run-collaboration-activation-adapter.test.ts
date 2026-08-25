import { describe, expect, it, vi } from 'vitest';

import { createRootTask } from '../../domain/tasks/task.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { PlannedCollaborationActivation } from './collaboration-activation-planner.js';
import { TaskRunCollaborationActivationAdapter } from './task-run-collaboration-activation-adapter.js';

const now = () => new Date('2026-08-20T00:00:00.000Z');
const owner = {
  tenantId: 'tenant-freshness',
  workspaceId: 'workspace-freshness',
  principalType: 'user',
  principalId: 'user-freshness',
} as const;

const team = createTeamRun({
  id: 'team-freshness',
  ...owner,
  rootTaskId: 'root-freshness',
  rootRunId: 'root-run-freshness',
  teamVersionId: 'team-version-freshness',
  environmentVersionId: 'environment-freshness',
  initialLeadTurn: false,
  completionApprovalRequired: false,
  now,
});

const member: TeamMemberRun = {
  id: 'member-freshness',
  teamRunId: team.id,
  name: 'Member',
  role: 'member',
  workerVersionId: 'member-worker',
  runtimeSessionId: null,
  status: 'idle',
  currentWorkItemId: null,
  ...owner,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
};

const work: TeamWorkItem = {
  id: 'work-freshness',
  teamRunId: team.id,
  subject: 'Open work',
  description: null,
  status: 'open',
  ownerMemberId: null,
  createdByMemberId: member.id,
  completionSummary: null,
  executionTaskId: null,
  ...owner,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
  completedAt: null,
};

const plan: PlannedCollaborationActivation = {
  activation: {
    participantId: member.id,
    causes: [],
    priority: 'normal',
    dedupeKey: 'dedupe-freshness',
  },
  primaryWorkMessage: null,
  workAttempt: null,
  workAvailableItem: work,
  directMessages: [],
  finalReview: false,
  reviewFeedback: null,
};

function rootTaskAt(updatedAt: string) {
  const base = createRootTask({
    id: team.rootTaskId,
    ...owner,
    policySnapshotVersion: 'policy-freshness',
    invokableKind: 'team',
    invokableVersionId: team.teamVersionId,
    inputSnapshotRef: 'snapshot:freshness',
    inputFingerprint: 'fingerprint:freshness',
    ingress: 'api',
    originRef: null,
    now,
  });
  return { ...base, updatedAt };
}

function setup(options: {
  readonly outerRootTaskUpdatedAt: string;
  readonly innerRootTaskUpdatedAt: string;
}) {
  const saveTask = vi.fn(async () => undefined);
  const saveRun = vi.fn(async () => undefined);
  const updateMemberRunStatus = vi.fn(async () => member);
  const enqueueRunDispatch = vi.fn(async () => undefined);
  const innerFindById = vi.fn(async () =>
    rootTaskAt(options.innerRootTaskUpdatedAt),
  );
  const withTransaction = vi.fn(
    async (operation: (tx: any) => Promise<unknown>) =>
      operation({
        tasks: { save: saveTask, findById: innerFindById },
        runs: { save: saveRun },
        teamExecutions: { updateMemberRunStatus },
        enqueueRunDispatch,
      }),
  );
  const tasks = {
    findById: vi.fn(async () => rootTaskAt(options.outerRootTaskUpdatedAt)),
  };
  const adapter = new TaskRunCollaborationActivationAdapter(
    tasks as never,
    { withTransaction } as never,
    {} as never,
    now,
  );
  return { adapter, saveTask, saveRun, enqueueRunDispatch, withTransaction };
}

describe('TaskRunCollaborationActivationAdapter freshness preflight', () => {
  it('materializes activation when the root task is unchanged since it was read', async () => {
    const state = setup({
      outerRootTaskUpdatedAt: now().toISOString(),
      innerRootTaskUpdatedAt: now().toISOString(),
    });

    const result = await state.adapter.materialize({
      team,
      member,
      owner,
      plan,
      workItems: [work],
      senderNameById: new Map(),
    });

    expect(result.taskId).toBeTruthy();
    expect(state.saveTask).toHaveBeenCalledTimes(1);
    expect(state.saveRun).toHaveBeenCalledTimes(1);
    expect(state.enqueueRunDispatch).toHaveBeenCalledTimes(1);
  });

  it('rejects activation when the root task was concurrently modified after it was read', async () => {
    const state = setup({
      outerRootTaskUpdatedAt: now().toISOString(),
      innerRootTaskUpdatedAt: new Date(
        '2026-08-20T00:05:00.000Z',
      ).toISOString(),
    });

    await expect(
      state.adapter.materialize({
        team,
        member,
        owner,
        plan,
        workItems: [work],
        senderNameById: new Map(),
      }),
    ).rejects.toThrow(/concurrently modified/);

    expect(state.saveTask).not.toHaveBeenCalled();
    expect(state.saveRun).not.toHaveBeenCalled();
    expect(state.enqueueRunDispatch).not.toHaveBeenCalled();
  });
});
