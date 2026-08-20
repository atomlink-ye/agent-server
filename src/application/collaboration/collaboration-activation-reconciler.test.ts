import { describe, expect, it, vi } from 'vitest';

import { createChildTask, createRootTask } from '../../domain/tasks/task.js';
import { createTeamCompletionDecision } from '../../domain/teams/team-completion-decision.js';
import { createTeamMessage } from '../../domain/teams/team-message.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import type { TeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import { CollaborationActivationReconciler } from './collaboration-activation-reconciler.js';

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
const lead: TeamMemberRun = {
  id: 'lead-approval',
  teamRunId: team.id,
  name: 'Lead',
  role: 'lead',
  agentVersionId: 'lead-agent',
  runtimeSessionId: null,
  status: 'active',
  currentWorkItemId: null,
  ...owner,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
};
const member: TeamMemberRun = {
  ...lead,
  id: 'member-approval',
  name: 'Member',
  role: 'member',
  agentVersionId: 'member-agent',
  status: 'idle',
};
const attempt: TeamWorkItemAttempt = {
  id: 'attempt-approval-2',
  workItemId: 'work-approval',
  teamRunId: team.id,
  attemptNo: 2,
  assigneeMemberId: member.id,
  requestedByLeadTaskId: 'lead-task-approval',
  feedback: 'Please revise.',
  executionTaskId: null,
  status: 'queued',
  resultSummary: null,
  ...owner,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
  completedAt: null,
};
const work: TeamWorkItem = {
  id: attempt.workItemId,
  teamRunId: team.id,
  subject: 'Rejected work',
  description: 'Work requiring rework',
  status: 'pending',
  ownerMemberId: member.id,
  createdByMemberId: lead.id,
  completionSummary: null,
  executionTaskId: null,
  ...owner,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
  completedAt: null,
};
const wake = {
  ...createTeamMessage({
    id: 'wake-approval',
    teamRunId: team.id,
    ...owner,
    senderMemberRunId: lead.id,
    recipientMemberRunId: member.id,
    workItemId: work.id,
    attemptId: attempt.id,
    kind: 'wake',
    dedupKey: 'wake-approval',
    body: 'feedback_ready',
    now,
  }),
  sequence: 2,
};

function setup(
  latestDecision: ReturnType<typeof createTeamCompletionDecision> | null,
) {
  let executionTaskId: string | null = null;
  const materializeAttempt = vi.fn(
    async (input: { executionTaskId: string }) => {
      executionTaskId = input.executionTaskId;
      return { ...attempt, executionTaskId, status: 'running' as const };
    },
  );
  const updateMemberRunStatus = vi.fn(async () => member);
  const saveTask = vi.fn(async () => undefined);
  const saveRun = vi.fn(async () => undefined);
  const bindToTask = vi.fn(async () => [wake]);
  const enqueueRunDispatch = vi.fn(async () => undefined);
  const withTransaction = vi.fn(
    async (operation: (tx: any) => Promise<unknown>) =>
      operation({
        tasks: { save: saveTask, findById: vi.fn(async () => rootTask) },
        runs: { save: saveRun },
        teamMessages: { bindToTask },
        teamExecutions: { materializeAttempt, updateMemberRunStatus },
        enqueueRunDispatch,
      }),
  );
  const executions = {
    findTeamRunByRootTaskId: vi.fn(async () => team),
    findMembersByTeamRunId: vi.fn(async () => [lead, member]),
    findAttemptsByTeamRunId: vi.fn(async () => [
      { ...attempt, executionTaskId },
    ]),
    findWorkItemsByTeamRunId: vi.fn(async () => [work]),
    findWorkDependenciesByTeamRunId: vi.fn(async () => []),
    findCompletionDecisionForRequest: vi.fn(async () => latestDecision),
  } as unknown as TeamExecutionRepository;
  const messages = {
    listQueuedForMember: vi.fn(
      async (_teamId: string, participantId: string) =>
        participantId === member.id && executionTaskId === null ? [wake] : [],
    ),
    listQueuedWakeRoots: vi.fn(async () => [
      { rootTaskId: team.rootTaskId, owner },
    ]),
  };
  const tasks = {
    findById: vi.fn(async () => rootTask),
    findByRootTaskIdForOwner: vi.fn(async () => []),
  };
  const reconciler = new CollaborationActivationReconciler(
    messages as never,
    executions,
    tasks as never,
    { withTransaction } as never,
    undefined,
    now,
  );
  return {
    reconciler,
    withTransaction,
    materializeAttempt,
    updateMemberRunStatus,
    enqueueRunDispatch,
  };
}

describe('CollaborationActivationReconciler', () => {
  it('does not schedule final review while a direct-message turn is active on an empty board', async () => {
    const directTask = {
      ...createChildTask({
        id: 'direct-message-active',
        ...owner,
        policySnapshotVersion: 'policy-approval',
        rootTaskId: team.rootTaskId,
        parentTaskId: team.rootTaskId,
        parentRunId: team.rootRunId,
        invokableKind: 'agent',
        invokableVersionId: member.agentVersionId,
        inputSnapshotRef: 'snapshot:direct-message',
        inputFingerprint: 'fingerprint:direct-message',
        logicalStepKey: 'message:active',
        nodePath: 'message:active',
        teamMemberRunId: member.id,
        teamSequence: 1,
        teamTaskKind: 'direct_message',
        now,
      }),
      status: 'running' as const,
    };
    const tasks = {
      findByRootTaskIdForOwner: vi.fn(async () => [
        {
          task: directTask,
          latestRun: {
            runId: 'direct-message-run',
            attempt: 1,
            status: 'running' as const,
            runtime: null,
            result: null,
            error: null,
            createdAt: now().toISOString(),
            updatedAt: now().toISOString(),
          },
        },
      ]),
    };
    const reconciler = new CollaborationActivationReconciler(
      {} as never,
      {} as never,
      tasks as never,
      {} as never,
      undefined,
      now,
    );
    const readyForLeadReview = (
      reconciler as unknown as {
        readyForLeadReview(
          team: TeamRun,
          lead: TeamMemberRun,
          attempts: readonly TeamWorkItemAttempt[],
          workItems: readonly TeamWorkItem[],
          dependencies: readonly unknown[],
          owner: OwnerScope,
        ): Promise<boolean>;
      }
    ).readyForLeadReview.bind(reconciler);

    await expect(
      readyForLeadReview(team, lead, [], [], [], owner),
    ).resolves.toBe(false);
  });

  it('freezes participant activation while human completion approval is pending', async () => {
    const state = setup(null);
    expect(
      await state.reconciler.reconcileForRootTask(team.rootTaskId, owner),
    ).toBe(0);
    expect(state.withTransaction).not.toHaveBeenCalled();
  });

  it('resumes durable feedback activation after a matching rejection', async () => {
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
      targets: [{ workItemId: work.id, attemptNoAtDecision: 1 }],
    });
    const state = setup(decision);

    expect(
      await state.reconciler.reconcileForRootTask(team.rootTaskId, owner),
    ).toBe(1);
    expect(state.materializeAttempt).toHaveBeenCalledTimes(1);
    expect(state.enqueueRunDispatch).toHaveBeenCalledTimes(1);
  });

  it('can recover a pending durable root without an in-process mutation signal', async () => {
    const decision = createTeamCompletionDecision({
      id: 'decision-restart',
      ...owner,
      teamRunId: team.id,
      completionRequestedByRunId: team.completionRequestedByRunId!,
      decision: 'reject',
      feedback: 'Resume after restart.',
      decidedBy: 'reviewer-approval',
      decidedAt: now().toISOString(),
      leadTurnCountAtDecision: team.leadTurnCount,
      targets: [{ workItemId: work.id, attemptNoAtDecision: 1 }],
    });
    const state = setup(decision);
    expect(await state.reconciler.reconcilePendingRoots()).toBe(1);
    expect(state.materializeAttempt).toHaveBeenCalledTimes(1);
  });
});
