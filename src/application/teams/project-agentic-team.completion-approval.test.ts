import { describe, expect, it, vi } from 'vitest';

import { createTeamCompletionDecision } from '../../domain/teams/team-completion-decision.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import { ProjectAgenticTeam } from './project-agentic-team.js';

const owner = {
  tenantId: 'tenant-project',
  workspaceId: 'workspace-project',
  principalType: 'user',
  principalId: 'user-project',
} as const;
const now = () => new Date('2026-08-08T00:00:00.000Z');

function fixture(decision: 'pending' | 'reject') {
  const team = {
    ...createTeamRun({
      id: '00000000-0000-4000-8000-000000000101',
      ...owner,
      rootTaskId: '00000000-0000-4000-8000-000000000102',
      rootRunId: '00000000-0000-4000-8000-000000000103',
      teamVersionId: '00000000-0000-4000-8000-000000000104',
      environmentVersionId: '00000000-0000-4000-8000-000000000105',
      completionApprovalRequired: true,
      now,
    }),
    completionRequestedByRunId: '00000000-0000-4000-8000-000000000106',
    phase: 'lead_finalize' as const,
  };
  const rejection = createTeamCompletionDecision({
    id: '00000000-0000-4000-8000-000000000107',
    ...owner,
    teamRunId: team.id,
    completionRequestedByRunId: team.completionRequestedByRunId!,
    decision: 'reject',
    feedback: 'Add source links.',
    decidedBy: 'reviewer',
    decidedAt: '2026-08-08T00:01:00.000Z',
    teamRevisionAtDecision: 3,
    leadTurnCountAtDecision: 2,
    targets: [
      {
        workItemId: '00000000-0000-4000-8000-000000000108',
        attemptNoAtDecision: 1,
      },
    ],
  });
  const teams = {
    findTeamRunById: vi.fn(async () => team),
    findMembersByTeamRunId: vi.fn(async () => []),
    findWorkItemsByTeamRunId: vi.fn(async () => []),
    findAttemptsByTeamRunId: vi.fn(async () => []),
    findWorkDependenciesByTeamRunId: vi.fn(async () => []),
    findCompletionDecisionForRequest: vi.fn(async () =>
      decision === 'reject' ? rejection : null,
    ),
    findCompletionDecisionsByTeamRunId: vi.fn(async () =>
      decision === 'reject' ? [rejection] : [],
    ),
  };
  const project = new ProjectAgenticTeam(
    teams as never,
    { listDirectForTeamRun: vi.fn(async () => []) } as never,
    { findByRootTaskIdForOwner: vi.fn(async () => []) } as never,
  );
  return { project, team, rejection };
}

describe('ProjectAgenticTeam completion approval projection', () => {
  it('projects a pending raw active run as public waiting with approval history', async () => {
    const { project, team } = fixture('pending');
    const result = await project.project(team.id, owner);
    expect(result?.project).toMatchObject({
      status: 'waiting',
      stopReason: 'approval_required',
      completionApprovalRequired: true,
      completionDecisions: [],
    });
  });

  it('projects a matching rejection as active while retaining ordered history', async () => {
    const { project, team, rejection } = fixture('reject');
    const result = await project.project(team.id, owner);
    expect(result?.project).toMatchObject({
      status: 'active',
      stopReason: null,
      completionDecisions: [
        expect.objectContaining({
          id: rejection.id,
          decision: 'reject',
          feedback: 'Add source links.',
          targets: [
            {
              workItemId: rejection.targets[0]!.workItemId,
              attemptNoAtDecision: 1,
            },
          ],
        }),
      ],
    });
  });
});
