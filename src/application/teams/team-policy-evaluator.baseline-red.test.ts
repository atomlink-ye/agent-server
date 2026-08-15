import { describe, expect, it } from 'vitest';

import {
  createTeamCompletionDecision,
  type TeamCompletionDecision,
} from '../../domain/teams/team-completion-decision.js';
import type { TeamRun } from '../../domain/teams/team-run.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import {
  canonicalTeamToolRefsForLeadPolicy,
  deriveAgenticLeadCommandPolicy,
} from './team-policy-evaluator.js';
import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../../domain/teams/canonical-team-role-tools.js';
import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';

const now = () => new Date('2026-08-08T00:00:00.000Z');
const owner = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'user',
  principalId: 'user-1',
};

function makeTeam(overrides: Partial<TeamRun> = {}): TeamRun {
  return {
    ...createTeamRun({
      id: 'team-run-policy',
      ...owner,
      rootTaskId: 'root-task-policy',
      rootRunId: 'root-run-policy',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      now,
    }),
    ...overrides,
  };
}

function makeWork(
  teamRunId: string,
  id = 'work-1',
  status: TeamWorkItem['status'] = 'accepted',
): TeamWorkItem {
  return {
    id,
    teamRunId,
    subject: 'Prepare the report',
    description: 'Prepare a report',
    status,
    ownerMemberId: 'member-1',
    createdByMemberId: 'lead-1',
    completionSummary: 'Draft report',
    executionTaskId: 'attempt-task-1',
    ...owner,
    createdAt: '2026-08-08T00:01:00.000Z',
    updatedAt: '2026-08-08T00:01:00.000Z',
    completedAt: '2026-08-08T00:01:00.000Z',
  };
}

function makeAttempt(
  teamRunId: string,
  workItemId: string,
  attemptNo = 1,
): TeamWorkItemAttempt {
  return {
    id: `attempt-${attemptNo}`,
    workItemId,
    teamRunId,
    attemptNo,
    assigneeMemberId: 'member-1',
    requestedByLeadTaskId: 'lead-task-1',
    feedback: null,
    executionTaskId: `attempt-task-${attemptNo}`,
    status: 'completed',
    resultSummary: 'Completed report draft',
    ...owner,
    createdAt: `2026-08-08T00:0${attemptNo + 1}:00.000Z`,
    updatedAt: `2026-08-08T00:0${attemptNo + 1}:00.000Z`,
    completedAt: `2026-08-08T00:0${attemptNo + 1}:00.000Z`,
  };
}

function makeRejectDecision(
  team: TeamRun,
  workItem: TeamWorkItem,
  attemptNoAtDecision = 1,
  leadTurnCountAtDecision = team.leadTurnCount,
): TeamCompletionDecision {
  return createTeamCompletionDecision({
    id: 'decision-1',
    teamRunId: team.id,
    tenantId: team.tenantId,
    workspaceId: team.workspaceId,
    principalType: team.principalType,
    principalId: team.principalId,
    decision: 'reject',
    completionRequestedByRunId: team.id,
    feedback: 'Please revise the report with source links.',
    decidedBy: 'lead-member-1',
    decidedAt: '2026-08-08T00:02:00.000Z',
    leadTurnCountAtDecision,
    targets: [{ workItemId: workItem.id, attemptNoAtDecision }],
  });
}

describe('deriveAgenticLeadCommandPolicy future rejection semantics (baseline RED)', () => {
  it('does not grant collaboration rework when the current policy only finishes', () => {
    const team = makeTeam();
    const workItem = makeWork(team.id, 'work-1', 'accepted');
    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
    );

    const refs = canonicalTeamToolRefsForLeadPolicy(policy);

    expect(policy.allowedCommands).toEqual(['team_finish']);
    expect(refs).toContain(AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS.finish);
    expect(refs).toContain(AGENT_SERVER_COLLABORATION_TOOL_REFS.finish);
    expect(refs).not.toContain(
      AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
    );
  });

  it('allows request_changes on an accepted-only board after the latest reject instead of finish-only', () => {
    const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
    const workItem = makeWork(team.id);
    const decision = makeRejectDecision(team, workItem);

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      decision,
    );

    expect(policy.allowedCommands).toContain('team_work_request_changes');
    expect(policy.allowedCommands).not.toContain('team_finish');
  });

  it('includes a rejected accepted target in eligibleReworkWorkItemIds', () => {
    const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
    const workItem = makeWork(team.id);
    const decision = makeRejectDecision(team, workItem);

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      decision,
    );

    expect(policy.eligibleReworkWorkItemIds).toContain(workItem.id);
  });

  it('lets a rejected target at attempt two bypass maxAttemptsPerItem', () => {
    const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
    const workItem = makeWork(team.id);
    const decision = makeRejectDecision(team, workItem, 2);

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id, 2)],
      decision,
    );

    expect(policy.limits.maxAttemptsPerItem).toBe(2);
    expect(policy.eligibleReworkWorkItemIds).toContain(workItem.id);
    expect(policy.allowedCommands).toContain('team_work_request_changes');
  });

  it('resumes policy from the latest reject despite a retained completion request', () => {
    const team = makeTeam({
      completionRequestedByRunId: 'team-run-policy',
      leadTurnCount: 3,
    });
    const workItem = makeWork(team.id);
    const decision = makeRejectDecision(team, workItem);

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      decision,
    );

    expect(policy.allowedCommands).toContain('team_work_request_changes');
    expect(policy.limits.remainingLeadTurns).toBeGreaterThan(0);
  });

  it('starts a fresh lead-turn epoch from a latest reject at the max-turn boundary', () => {
    const team = makeTeam({
      leadTurnCount: 8,
      completionRequestedByRunId: 'team-run-policy',
    });
    const workItem = makeWork(team.id);
    const decision = makeRejectDecision(team, workItem, 1, 8);

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      decision,
    );

    expect(policy.limits.maxLeadTurns).toBe(8);
    expect(policy.limits.remainingLeadTurns).toBe(8);
    expect(policy.allowedCommands).toContain('team_work_request_changes');
    expect(policy.eligibleReworkWorkItemIds).toContain(workItem.id);
  });

  it('does not authorize rework when the decision belongs to another team run', () => {
    const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
    const workItem = makeWork(team.id);
    const decision = {
      ...makeRejectDecision(team, workItem),
      teamRunId: 'other-team-run',
    };

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      decision,
    );

    expect(policy.eligibleReworkWorkItemIds).not.toContain(workItem.id);
    expect(policy.allowedCommands).toEqual([]);
  });

  it.each(['cancelled', 'in_progress'] as const)(
    'does not special-case a %s target for human rework bypass',
    (status) => {
      const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
      const workItem = makeWork(team.id, 'work-1', status);
      const decision = makeRejectDecision(team, workItem, 2);

      const policy = deriveAgenticLeadCommandPolicy(
        team,
        [workItem],
        [makeAttempt(team.id, workItem.id, 2)],
        decision,
      );

      expect(policy.eligibleReworkWorkItemIds).not.toContain(workItem.id);
      expect(policy.allowedCommands).not.toContain('team_work_request_changes');
    },
  );

  it('consumes a target authorization once a newer attempt exists', () => {
    const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
    const workItem = makeWork(team.id);
    const decision = makeRejectDecision(team, workItem, 1);

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id, 2)],
      decision,
    );

    expect(policy.eligibleReworkWorkItemIds).not.toContain(workItem.id);
    expect(policy.allowedCommands).toContain('team_finish');
  });

  it('fails closed when a corrupt future decision count is persisted', () => {
    const team = makeTeam({
      completionRequestedByRunId: 'team-run-policy',
      leadTurnCount: 7,
    });
    const workItem = makeWork(team.id);
    const decision = makeRejectDecision(team, workItem, 1, 8);

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      decision,
    );

    expect(policy.limits.remainingLeadTurns).toBe(1);
    expect(policy.allowedCommands).toEqual([]);
    expect(policy.eligibleReworkWorkItemIds).toEqual([]);
  });

  it('budgets seven turns after one turn of progression from decision count eight', () => {
    const team = makeTeam({
      completionRequestedByRunId: 'team-run-policy',
      leadTurnCount: 9,
    });
    const workItem = makeWork(team.id);
    const decision = makeRejectDecision(team, workItem, 1, 8);

    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      decision,
    );

    expect(policy.limits.remainingLeadTurns).toBe(7);
  });

  it.each(['tenantId', 'workspaceId', 'principalType', 'principalId'] as const)(
    'rejects a decision with mismatched %s owner scope',
    (field) => {
      const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
      const workItem = makeWork(team.id);
      const decision = {
        ...makeRejectDecision(team, workItem),
        [field]: 'other-owner',
      } as TeamCompletionDecision;

      const policy = deriveAgenticLeadCommandPolicy(
        team,
        [workItem],
        [makeAttempt(team.id, workItem.id)],
        decision,
      );

      expect(policy.allowedCommands).toEqual([]);
      expect(policy.eligibleReworkWorkItemIds).toEqual([]);
    },
  );
});
