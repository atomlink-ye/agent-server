import { describe, expect, it, vi } from 'vitest';

import { ProjectAgenticTeam } from './project-agentic-team.js';
import type {
  OwnerScope,
  TeamExecutionRepository,
} from '../ports/team-execution-repository.js';
import type { TeamMessageRepository } from '../ports/team-message-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import { createTeamRun } from '../../domain/teams/team-run.js';

const owner: OwnerScope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  principalType: 'user',
  principalId: 'user-1',
};

describe('ProjectAgenticTeam', () => {
  it('projects runtime provider/model, work description, revision, stop reason, and every attempt', async () => {
    const team = {
      ...createTeamRun({
        id: '00000000-0000-4000-8000-000000000010',
        tenantId: owner.tenantId,
        workspaceId: owner.workspaceId,
        principalType: owner.principalType,
        principalId: owner.principalId,
        rootTaskId: '00000000-0000-4000-8000-000000000011',
        rootRunId: '00000000-0000-4000-8000-000000000012',
        teamVersionId: '00000000-0000-4000-8000-000000000013',
        environmentVersionId: '00000000-0000-4000-8000-000000000014',
        now: () => new Date('2026-08-07T00:00:00.000Z'),
      }),
      revision: 42,
      stopReason: 'lead_turn_limit',
      status: 'failed' as const,
      phase: 'done' as const,
    };
    const member = {
      id: '00000000-0000-4000-8000-000000000020',
      teamRunId: team.id,
      name: 'fixer',
      role: 'member' as const,
      agentVersionId: '00000000-0000-4000-8000-000000000021',
      runtimeSessionId: null,
      status: 'idle' as const,
      currentWorkItemId: null,
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      principalType: owner.principalType,
      principalId: owner.principalId,
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    };
    const work = {
      id: '00000000-0000-4000-8000-000000000030',
      teamRunId: team.id,
      subject: 'Implement typed detail',
      description: 'Preserve provider semantics through persistence.',
      status: 'accepted' as const,
      ownerMemberId: member.id,
      createdByMemberId: member.id,
      completionSummary: 'Done',
      executionTaskId: '00000000-0000-4000-8000-000000000032',
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      principalType: owner.principalType,
      principalId: owner.principalId,
      createdAt: '2026-08-07T00:00:01.000Z',
      updatedAt: '2026-08-07T00:00:03.000Z',
      completedAt: '2026-08-07T00:00:03.000Z',
    };
    const attempts = [
      {
        id: '00000000-0000-4000-8000-000000000041',
        workItemId: work.id,
        teamRunId: team.id,
        attemptNo: 2,
        assigneeMemberId: member.id,
        requestedByLeadTaskId: '00000000-0000-4000-8000-000000000052',
        feedback: null,
        executionTaskId: '00000000-0000-4000-8000-000000000053',
        status: 'completed' as const,
        resultSummary: 'Provider projection added',
        ...owner,
        createdAt: '2026-08-07T00:00:06.000Z',
        updatedAt: '2026-08-07T00:00:07.000Z',
        completedAt: '2026-08-07T00:00:07.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000040',
        workItemId: work.id,
        teamRunId: team.id,
        attemptNo: 1,
        assigneeMemberId: member.id,
        requestedByLeadTaskId: '00000000-0000-4000-8000-000000000050',
        feedback: 'Please add the provider projection.',
        executionTaskId: '00000000-0000-4000-8000-000000000051',
        status: 'failed' as const,
        resultSummary: 'Missing provider field',
        ...owner,
        createdAt: '2026-08-07T00:00:04.000Z',
        updatedAt: '2026-08-07T00:00:05.000Z',
        completedAt: '2026-08-07T00:00:05.000Z',
      },
    ];
    const task = {
      id: '00000000-0000-4000-8000-000000000053',
      createdAt: '2026-08-07T00:00:06.000Z',
      // AgentVersion policy requests a different provider/model; projection
      // must use latestRun.runtime below instead.
      invokableVersionId: 'strategy-provider/model',
      teamMemberRunId: member.id,
      teamTaskKind: 'work_attempt' as const,
      teamSequence: 1,
      sourceTeamMessageId: null,
    };
    const executions = {
      findTeamRunById: vi.fn(async () => team),
      findMembersByTeamRunId: vi.fn(async () => [member]),
      findWorkItemsByTeamRunId: vi.fn(async () => [work]),
      findAttemptsByTeamRunId: vi.fn(async () => attempts),
      findWorkDependenciesByTeamRunId: vi.fn(async () => []),
    } as unknown as TeamExecutionRepository;
    const messages = {
      listDirectForTeamRun: vi.fn(async () => []),
    } as unknown as TeamMessageRepository;
    const tasks = {
      findByRootTaskIdForOwner: vi.fn(async () => [
        {
          task,
          latestRun: {
            runId: '00000000-0000-4000-8000-000000000054',
            attempt: 1,
            status: 'succeeded' as const,
            // Deliberately differs from the AgentVersion policy's requested value.
            runtime: { provider: 'actual-provider', model: 'actual/model' },
            result: { text: 'completed output' },
            error: null,
            createdAt: '2026-08-07T00:00:08.000Z',
            updatedAt: '2026-08-07T00:00:09.000Z',
          },
        },
      ]),
    } as unknown as TaskRepository;

    const projection = await new ProjectAgenticTeam(
      executions,
      messages,
      tasks,
    ).project(team.id, owner);
    expect(projection).not.toBeNull();

    const projected = projection as any;
    expect(projected.project).toMatchObject({
      revision: 42,
      stopReason: 'lead_turn_limit',
    });
    expect(projected.workItems[0]).toMatchObject({
      subject: work.subject,
      description: work.description,
      latestAttempt: {
        attemptNo: 2,
        resultSummary: 'Provider projection added',
      },
      attempts: [
        {
          attemptNo: 1,
          feedbackSummary: 'Please add the provider projection.',
          resultSummary: 'Missing provider field',
        },
        {
          attemptNo: 2,
          resultSummary: 'Provider projection added',
        },
      ],
    });
    expect(projected.sessions[0].turns[0]).toMatchObject({
      provider: 'actual-provider',
      model: 'actual/model',
    });
  });
});
