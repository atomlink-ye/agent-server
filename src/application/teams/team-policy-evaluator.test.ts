import { describe, expect, it } from 'vitest';

import {
  createTeamCompletionDecision,
  type TeamCompletionDecision,
} from '../../domain/teams/team-completion-decision.js';
import { createTeamRun, type TeamRun } from '../../domain/teams/team-run.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import { AGENT_SERVER_COLLABORATION_TOOL_REFS } from '../../domain/collaboration/canonical-collaboration-tools.js';
import {
  collaborationToolRefsForMessageTurn,
  collaborationToolRefsForLeadPolicy,
  deriveAgenticLeadCommandPolicy,
} from './team-policy-evaluator.js';

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

describe('deriveAgenticLeadCommandPolicy', () => {
  it('allows a Lead to finish from a direct-message turn', () => {
    expect(collaborationToolRefsForMessageTurn('lead')).toContain(
      AGENT_SERVER_COLLABORATION_TOOL_REFS.finish,
    );
  });

  it('exposes only the canonical finish ref when the accepted board can finish', () => {
    const team = makeTeam();
    const workItem = makeWork(team.id);
    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
    );
    const refs = collaborationToolRefsForLeadPolicy(policy);
    expect(policy.allowedCommands).toEqual(['collaboration_finish']);
    expect(refs).toContain(AGENT_SERVER_COLLABORATION_TOOL_REFS.finish);
    expect(refs).not.toContain(
      AGENT_SERVER_COLLABORATION_TOOL_REFS.boardRequestChanges,
    );
  });

  it('allows request_changes after the latest completion rejection', () => {
    const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
    const workItem = makeWork(team.id);
    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      makeRejectDecision(team, workItem),
    );
    expect(policy.allowedCommands).toContain('board_request_changes');
    expect(policy.allowedCommands).not.toContain('collaboration_finish');
    expect(policy.eligibleReworkWorkItemIds).toContain(workItem.id);
  });

  it('lets a rejected target at attempt two bypass the ordinary attempt budget', () => {
    const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
    const workItem = makeWork(team.id);
    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id, 2)],
      makeRejectDecision(team, workItem, 2),
    );
    expect(policy.limits.maxAttemptsPerItem).toBe(2);
    expect(policy.eligibleReworkWorkItemIds).toContain(workItem.id);
    expect(policy.allowedCommands).toContain('board_request_changes');
  });

  it('starts a fresh lead-turn budget epoch from a latest rejection', () => {
    const team = makeTeam({
      leadTurnCount: 8,
      completionRequestedByRunId: 'team-run-policy',
    });
    const workItem = makeWork(team.id);
    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id)],
      makeRejectDecision(team, workItem, 1, 8),
    );
    expect(policy.limits.maxLeadTurns).toBe(8);
    expect(policy.limits.remainingLeadTurns).toBe(8);
    expect(policy.allowedCommands).toContain('board_request_changes');
  });

  it('does not authorize a rejection decision from another scope', () => {
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
    expect(policy.allowedCommands).toEqual([]);
    expect(policy.eligibleReworkWorkItemIds).toEqual([]);
  });

  it.each(['cancelled', 'in_progress'] as const)(
    'does not special-case a %s target for rejection rework',
    (status) => {
      const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
      const workItem = makeWork(team.id, 'work-1', status);
      const policy = deriveAgenticLeadCommandPolicy(
        team,
        [workItem],
        [makeAttempt(team.id, workItem.id, 2)],
        makeRejectDecision(team, workItem, 2),
      );
      expect(policy.eligibleReworkWorkItemIds).not.toContain(workItem.id);
      expect(policy.allowedCommands).not.toContain('board_request_changes');
    },
  );

  it('consumes rejection authorization once a newer attempt exists', () => {
    const team = makeTeam({ completionRequestedByRunId: 'team-run-policy' });
    const workItem = makeWork(team.id);
    const policy = deriveAgenticLeadCommandPolicy(
      team,
      [workItem],
      [makeAttempt(team.id, workItem.id, 2)],
      makeRejectDecision(team, workItem, 1),
    );
    expect(policy.eligibleReworkWorkItemIds).not.toContain(workItem.id);
    expect(policy.allowedCommands).toContain('collaboration_finish');
  });

  it.each(['tenantId', 'workspaceId', 'principalType', 'principalId'] as const)(
    'fails closed on mismatched %s',
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
