import { describe, expect, it, vi } from 'vitest';

import { createRootTask } from '../../domain/tasks/task.js';
import { createRun } from '../../domain/runs/run.js';
import { createTeamCompletionDecision } from '../../domain/teams/team-completion-decision.js';
import { createTeamMessage } from '../../domain/teams/team-message.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { TeamExecutionRepository } from '../ports/team-execution-repository.js';
import { TeamWakeReconciler } from './team-wake-reconciler.js';

const now = () => new Date('2026-08-08T00:00:00.000Z');
const owner = {
  tenantId: 'tenant-approval',
  workspaceId: 'workspace-approval',
  principalType: 'user',
  principalId: 'user-approval',
} as const;

const team = {
  ...createTeamRun({
    id: 'team-approval',
    ...owner,
    rootTaskId: 'root-approval',
    rootRunId: 'root-run-approval',
    teamVersionId: 'team-version-approval',
    environmentVersionId: 'environment-approval',
    initialLeadTurn: true,
    completionApprovalRequired: true,
    now,
  }),
  completionRequestedByRunId: 'completion-request-approval',
} as const;

const rootTask = createRootTask({
  id: team.rootTaskId,
  ...owner,
  policySnapshotVersion: 'policy-approval',
  invokableKind: 'team',
  invokableVersionId: team.teamVersionId,
  inputSnapshotRef: 'snapshot:approval',
  inputFingerprint: 'fingerprint:approval',
  ingress: 'api',
  originRef: null,
  now,
});

function member(
  id: string,
  name: string,
  role: 'lead' | 'member',
): TeamMemberRun {
  return {
    id,
    teamRunId: team.id,
    name,
    role,
    agentVersionId: `${id}-agent`,
    runtimeSessionId: null,
    status: role === 'lead' ? 'active' : 'idle',
    currentWorkItemId: null,
    ...owner,
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
  };
}

const lead = member('lead-approval', 'Lead', 'lead');
const directMember = member('direct-approval', 'Direct member', 'member');
const workMember = member('work-approval', 'Work member', 'member');

const directMessage = {
  ...createTeamMessage({
    id: 'message-direct-approval',
    teamRunId: team.id,
    ...owner,
    senderMemberRunId: lead.id,
    recipientMemberRunId: directMember.id,
    kind: 'direct',
    dedupKey: 'direct-approval',
    body: 'Please confirm the rejection feedback.',
    now,
  }),
  sequence: 1,
};

const completedAttempt: TeamWorkItemAttempt = {
  id: 'attempt-work-approval-1',
  workItemId: 'work-approval',
  teamRunId: team.id,
  attemptNo: 1,
  assigneeMemberId: workMember.id,
  requestedByLeadTaskId: 'lead-task-approval',
  feedback: null,
  executionTaskId: 'work-task-approval-1',
  status: 'completed',
  resultSummary: 'Initial work pass',
  ...owner,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
  completedAt: now().toISOString(),
};

// The rejection snapshots completed attempt 1; request-rework has already
// created queued attempt 2, which the wake reconciler may materialize.
const workAttempt: TeamWorkItemAttempt = {
  id: 'attempt-work-approval',
  workItemId: 'work-approval',
  teamRunId: team.id,
  attemptNo: 2,
  assigneeMemberId: workMember.id,
  requestedByLeadTaskId: 'lead-task-approval',
  feedback: null,
  executionTaskId: null,
  status: 'queued',
  resultSummary: null,
  ...owner,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
  completedAt: null,
};

const workMessage = {
  ...createTeamMessage({
    id: 'message-work-approval',
    teamRunId: team.id,
    ...owner,
    senderMemberRunId: lead.id,
    recipientMemberRunId: workMember.id,
    workItemId: workAttempt.workItemId,
    attemptId: workAttempt.id,
    kind: 'wake',
    dedupKey: 'wake-approval',
    body: 'Please complete the rejected work.',
    now,
  }),
  sequence: 2,
};

const workItem: TeamWorkItem = {
  id: workAttempt.workItemId,
  teamRunId: team.id,
  subject: 'Rejected work',
  description: 'Work requiring rework',
  status: 'pending',
  ownerMemberId: workMember.id,
  createdByMemberId: lead.id,
  completionSummary: null,
  executionTaskId: null,
  ...owner,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
  completedAt: null,
};

function setup(
  latestDecision: ReturnType<typeof createTeamCompletionDecision> | null,
) {
  const directClaim = vi.fn(async () => directMessage);
  const bindWork = vi.fn(async () => [workMessage]);
  const materialize = vi.fn(async (input: { executionTaskId: string }) => ({
    ...workAttempt,
    executionTaskId: input.executionTaskId,
  }));
  const saveTask = vi.fn(async () => undefined);
  const saveRun = vi.fn(async () => undefined);
  const enqueue = vi.fn(async () => undefined);
  const withTransaction = vi.fn(
    async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        tasks: { save: saveTask },
        runs: { save: saveRun },
        teamMessages: { claimDirectForTask: directClaim, bindToTask: bindWork },
        teamExecutions: { materializeAttempt: materialize },
        enqueueRunDispatch: enqueue,
      }),
  );
  const executions = {
    findTeamRunByRootTaskId: vi.fn(async () => team),
    findMembersByTeamRunId: vi.fn(async () => [lead, directMember, workMember]),
    findAttemptsByTeamRunId: vi.fn(async () => [completedAttempt, workAttempt]),
    findWorkItemsByTeamRunId: vi.fn(async () => [workItem]),
    findWorkDependenciesByTeamRunId: vi.fn(async () => []),
    findCompletionDecisionForRequest: vi.fn(async () => latestDecision),
    findLatestCompletionDecision: vi.fn(async () => latestDecision),
  } as unknown as TeamExecutionRepository;
  const messages = {
    listQueuedForMember: vi.fn(async (_teamId: string, memberId: string) =>
      memberId === directMember.id ? [directMessage] : [workMessage],
    ),
  };
  const tasks = { findById: vi.fn(async () => rootTask) };
  const admission = { withTransaction };
  const reconciler = new TeamWakeReconciler(
    messages as never,
    executions,
    tasks as never,
    admission as never,
    now,
  );
  return {
    reconciler,
    withTransaction,
    directClaim,
    bindWork,
    materialize,
    saveTask,
    saveRun,
  };
}

describe('TeamWakeReconciler completion approval gating', () => {
  it('freezes queued direct and work materialization while approval is pending', async () => {
    const setupState = setup(null);

    await setupState.reconciler.reconcileForRootTask(team.rootTaskId, owner);

    expect(setupState.withTransaction).not.toHaveBeenCalled();
    expect(setupState.directClaim).not.toHaveBeenCalled();
    expect(setupState.bindWork).not.toHaveBeenCalled();
    expect(setupState.materialize).not.toHaveBeenCalled();
  });

  it('unlocks queued direct and work materialization for the matching latest reject', async () => {
    const decision = createTeamCompletionDecision({
      id: 'decision-approval',
      ...owner,
      teamRunId: team.id,
      completionRequestedByRunId: team.completionRequestedByRunId!,
      decision: 'reject',
      feedback: 'Please revise the rejected work.',
      decidedBy: 'reviewer-approval',
      decidedAt: now().toISOString(),
      leadTurnCountAtDecision: team.leadTurnCount,
      targets: [{ workItemId: workItem.id, attemptNoAtDecision: 1 }],
    });
    const setupState = setup(decision);

    await setupState.reconciler.reconcileForRootTask(team.rootTaskId, owner);

    expect(setupState.withTransaction).toHaveBeenCalledTimes(2);
    expect(setupState.directClaim).toHaveBeenCalledTimes(1);
    expect(setupState.bindWork).toHaveBeenCalledTimes(1);
    expect(setupState.materialize).toHaveBeenCalledTimes(1);
    expect(setupState.saveTask).toHaveBeenCalledTimes(2);
    expect(setupState.saveRun).toHaveBeenCalledTimes(2);
  });
});
