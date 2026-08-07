import { describe, expect, it, vi } from 'vitest';

import { createChildTask } from '../../domain/tasks/task.js';
import { createTeamMemberRun } from '../../domain/teams/team-member-run.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import { ProjectAgenticTeam } from './project-agentic-team.js';

const now = () => new Date('2026-08-07T00:00:00.000Z');
const owner = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'user',
  principalId: 'user-1',
};

describe('ProjectAgenticTeam baseline RED coverage', () => {
  it('projects provider and model from the latest runtime rather than strategy metadata', async () => {
    const team = createTeamRun({
      id: 'team-run-provider',
      ...owner,
      rootTaskId: 'root-task-provider',
      rootRunId: 'root-run-provider',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      now,
    });
    const member = createTeamMemberRun({
      id: 'member-provider',
      teamRunId: team.id,
      name: 'lead',
      role: 'lead',
      agentVersionId: 'strategy-version-provider',
      ...owner,
      now,
    });
    const task = createChildTask({
      id: 'turn-task-provider',
      ...owner,
      policySnapshotVersion: 'policy-1',
      rootTaskId: team.rootTaskId,
      parentTaskId: team.rootTaskId,
      parentRunId: team.rootRunId,
      invokableKind: 'agent',
      invokableVersionId: 'strategy-version-provider',
      inputSnapshotRef: 'snapshot-provider',
      inputFingerprint: 'fingerprint-provider',
      logicalStepKey: 'lead:team-run-provider:turn:1',
      nodePath: 'lead-1',
      teamMemberRunId: member.id,
      teamSequence: 1,
      teamTaskKind: 'lead_turn',
      now,
    });
    const teams = {
      findTeamRunById: vi.fn(async () => team),
      findMembersByTeamRunId: vi.fn(async () => [member]),
      findWorkItemsByTeamRunId: vi.fn(async () => []),
      findAttemptsByTeamRunId: vi.fn(async () => []),
      findWorkDependenciesByTeamRunId: vi.fn(async () => []),
    };
    const tasks = {
      findByRootTaskIdForOwner: vi.fn(async () => [
        {
          task,
          latestRun: {
            runId: 'turn-run-provider',
            attempt: 1,
            status: 'succeeded',
            runtime: { provider: 'actual-provider', model: 'actual/model' },
            result: { text: 'completed' },
            error: null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        },
      ]),
    };
    const project = new ProjectAgenticTeam(
      teams as never,
      { listDirectForTeamRun: vi.fn(async () => []) } as never,
      tasks as never,
    );

    const projection = (await project.project(team.id, owner)) as any;

    expect(projection.sessions[0].turns[0].provider).toBe('actual-provider');
    expect(projection.sessions[0].turns[0].model).toBe('actual/model');
  });

  it('projects every work-item attempt in attempt-number order with rework feedback', async () => {
    const team = createTeamRun({
      id: 'team-run-attempts',
      ...owner,
      rootTaskId: 'root-task-attempts',
      rootRunId: 'root-run-attempts',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      now,
    });
    const work = {
      id: 'work-item-1',
      teamRunId: team.id,
      subject: 'Prepare the report',
      description: 'Prepare a report',
      status: 'in_progress',
      ownerMemberId: null,
      createdByMemberId: 'lead-member',
      completionSummary: null,
      executionTaskId: null,
      ...owner,
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      completedAt: null,
    };
    const attempt1 = {
      id: 'attempt-1',
      workItemId: work.id,
      teamRunId: team.id,
      attemptNo: 1,
      assigneeMemberId: 'member-1',
      requestedByLeadTaskId: 'lead-task-1',
      feedback: 'Please revise the report with source links.',
      executionTaskId: 'attempt-task-1',
      status: 'failed',
      resultSummary: 'First draft',
      ...owner,
      createdAt: '2026-08-07T00:01:00.000Z',
      updatedAt: '2026-08-07T00:01:00.000Z',
      completedAt: '2026-08-07T00:01:00.000Z',
    };
    const attempt2 = {
      ...attempt1,
      id: 'attempt-2',
      attemptNo: 2,
      feedback: null,
      executionTaskId: 'attempt-task-2',
      status: 'completed',
      resultSummary: 'Revised report',
      createdAt: '2026-08-07T00:02:00.000Z',
      updatedAt: '2026-08-07T00:02:00.000Z',
      completedAt: '2026-08-07T00:02:00.000Z',
    };
    const teams = {
      findTeamRunById: vi.fn(async () => team),
      findMembersByTeamRunId: vi.fn(async () => []),
      findWorkItemsByTeamRunId: vi.fn(async () => [work]),
      findAttemptsByTeamRunId: vi.fn(async () => [attempt2, attempt1]),
      findWorkDependenciesByTeamRunId: vi.fn(async () => []),
    };
    const project = new ProjectAgenticTeam(
      teams as never,
      { listDirectForTeamRun: vi.fn(async () => []) } as never,
      { findByRootTaskIdForOwner: vi.fn(async () => []) } as never,
    );

    const projection = (await project.project(team.id, owner)) as any;
    const attempts = projection.workItems[0].attempts;

    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt: any) => attempt.attemptNo)).toEqual([1, 2]);
    expect(attempts[0]).toEqual(
      expect.objectContaining({
        attemptNo: 1,
        feedbackSummary: 'Please revise the report with source links.',
      }),
    );
  });
});
