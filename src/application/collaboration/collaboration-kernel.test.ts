import { describe, expect, it, vi } from 'vitest';

import type { TeamToolContext } from '../teams/team-tool-context.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import { CollaborationKernel } from './collaboration-kernel.js';

function leadContext(): TeamToolContext {
  return {
    owner: {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
    },
    teamRun: {
      id: 'team-1',
      rootTaskId: 'root-1',
      revision: 1,
      status: 'active',
      controlState: 'lead_running',
      completionRequestedByRunId: null,
    },
    member: { id: 'lead-1', name: 'Lead', role: 'lead', status: 'active' },
    task: { id: 'task-1', teamTaskKind: 'lead_turn' },
    run: { id: 'run-1' },
    attempt: null,
    grant: {},
    allowedTools: [],
    contextEpoch: 'epoch',
  } as unknown as TeamToolContext;
}

describe('CollaborationKernel activation delivery', () => {
  it('returns durable mutation success even when the immediate activation kick throws', async () => {
    const context = leadContext();
    const created = {
      id: 'work-1',
      teamRunId: 'team-1',
      subject: 'Research market',
      description: null,
      status: 'open',
      ownerMemberId: null,
      createdByMemberId: 'lead-1',
      completionSummary: null,
      executionTaskId: null,
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      completedAt: null,
    } as const;
    const kernel = new CollaborationKernel(
      {
        findWorkItemsByTeamRunId: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([created]),
        findAttemptsByTeamRunId: vi.fn(async () => []),
      } as never,
      { createOpenWork: vi.fn(async () => created) } as never,
      {} as never,
      { append: vi.fn() },
      {
        kick: vi.fn(() => {
          throw new Error('scheduler temporarily unavailable');
        }),
      },
    );

    await expect(
      kernel.createWork(context, { subject: 'Research market' }),
    ).resolves.toEqual({ work_ref: 'W-1', status: 'open', owner: null });
  });

  it('projects logical participant names in the model-facing inbox', async () => {
    const context = leadContext();
    const kernel = new CollaborationKernel(
      {
        findWorkItemsByTeamRunId: vi.fn(async () => []),
        findMembersByTeamRunId: vi.fn(async () => [
          { id: 'member-1', name: 'Analyst' },
          { id: 'lead-1', name: 'Lead' },
        ]),
      } as never,
      {} as never,
      {
        listForTeamRun: vi.fn(async () => [
          {
            id: 'message-1',
            teamRunId: 'team-1',
            sequence: 1,
            kind: 'direct',
            senderMemberRunId: 'member-1',
            recipientMemberRunId: 'lead-1',
            body: 'Result is ready.',
            aboutWorkItemId: null,
            replyToMessageId: null,
            priority: 'normal',
            requiresAck: false,
            status: 'queued',
            createdAt: '2026-08-15T00:00:00.000Z',
          },
        ]),
      } as never,
      { append: vi.fn() },
    );

    const inbox = await kernel.inboxList(context);
    expect(inbox).toEqual([
      expect.objectContaining({ message_ref: 'M-1', from: 'Analyst' }),
    ]);
    expect(JSON.stringify(inbox)).not.toContain('member-1');
  });

  it('preflights a lead target against fresh board facts before mutation', async () => {
    const context = {
      ...leadContext(),
      teamRun: createTeamRun({
        id: 'team-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'service_account',
        principalId: 'principal-1',
        rootTaskId: 'root-1',
        rootRunId: 'root-run-1',
        teamVersionId: 'team-version-1',
        environmentVersionId: 'environment-1',
      }),
      task: { id: 'task-1', teamTaskKind: 'lead_turn' },
    } as unknown as TeamToolContext;
    const item = {
      id: 'work-1',
      teamRunId: 'team-1',
      status: 'accepted',
      createdAt: '2026-08-15T00:00:00.000Z',
    };
    const attempt = {
      id: 'attempt-1',
      workItemId: 'work-1',
      attemptNo: 1,
      status: 'completed',
      resultSummary: 'done',
    };
    const executions = {
      findWorkItemsByTeamRunId: vi.fn(async () => [item]),
      findAttemptsByTeamRunId: vi.fn(async () => [attempt]),
      findCompletionDecisionForRequest: vi.fn(async () => null),
      acceptWork: vi.fn(),
    };
    const kernel = new CollaborationKernel(
      executions as never,
      {} as never,
      {} as never,
      { append: vi.fn() },
    );

    await expect(
      kernel.acceptWork(context, { workRef: 'W-1' }),
    ).rejects.toMatchObject({ code: 'not_allowed' });
    expect(executions.acceptWork).not.toHaveBeenCalled();
  });
});
