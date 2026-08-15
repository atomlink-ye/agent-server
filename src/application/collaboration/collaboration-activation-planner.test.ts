import { describe, expect, it } from 'vitest';

import type { TeamMessage } from '../../domain/teams/team-message.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import { CollaborationActivationPlanner } from './collaboration-activation-planner.js';

const planner = new CollaborationActivationPlanner();
const now = '2026-08-15T00:00:00.000Z';

function message(
  id: string,
  sequence: number,
  input: Partial<TeamMessage> = {},
): TeamMessage {
  return {
    id,
    teamRunId: 'team-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'service_account',
    principalId: 'principal-1',
    sequence,
    senderMemberRunId: 'lead-1',
    recipientMemberRunId: 'member-1',
    workItemId: null,
    attemptId: null,
    aboutWorkItemId: null,
    replyToMessageId: null,
    kind: 'direct',
    dedupKey: id,
    body: `message ${id}`,
    priority: 'normal',
    requiresAck: false,
    status: 'queued',
    consumedByTaskId: null,
    sourceTaskId: 'task-lead',
    sourceRunId: 'run-lead',
    createdAt: now,
    consumedAt: null,
    acknowledgedAt: null,
    cancelledAt: null,
    ...input,
  };
}

function work(id: string, status: TeamWorkItem['status']): TeamWorkItem {
  return {
    id,
    teamRunId: 'team-1',
    subject: id,
    description: null,
    status,
    ownerMemberId: status === 'open' ? null : 'member-1',
    createdByMemberId: 'lead-1',
    completionSummary: null,
    executionTaskId: null,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'service_account',
    principalId: 'principal-1',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function attempt(input: Partial<TeamWorkItemAttempt> = {}): TeamWorkItemAttempt {
  return {
    id: 'attempt-1',
    workItemId: 'work-1',
    teamRunId: 'team-1',
    attemptNo: 1,
    assigneeMemberId: 'member-1',
    requestedByLeadTaskId: 'task-lead',
    feedback: null,
    executionTaskId: null,
    status: 'queued',
    resultSummary: null,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'service_account',
    principalId: 'principal-1',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...input,
  };
}

describe('CollaborationActivationPlanner', () => {
  it('coalesces assignment and multiple mailbox messages into one activation', () => {
    const workWake = message('wake-1', 1, {
      kind: 'wake',
      workItemId: 'work-1',
      attemptId: 'attempt-1',
    });
    const plan = planner.plan({
      participantId: 'member-1',
      messages: [
        workWake,
        message('message-1', 2),
        message('message-2', 3, { priority: 'urgent' }),
      ],
      workItems: [work('work-1', 'pending')],
      attempts: [attempt()],
      dependencies: [],
    });

    expect(plan).not.toBeNull();
    expect(plan!.activation.causes).toEqual([
      { type: 'assignment', workRef: 'W-1' },
      { type: 'message', messageRef: 'M-2' },
      { type: 'message', messageRef: 'M-3' },
    ]);
    expect(plan!.activation.priority).toBe('urgent');
    expect(plan!.directMessages).toHaveLength(2);
  });

  it('does not activate dependency-blocked work until dependencies are accepted', () => {
    const wake = message('wake-1', 1, {
      kind: 'wake',
      workItemId: 'work-2',
      attemptId: 'attempt-2',
    });
    const blocked = planner.plan({
      participantId: 'member-1',
      messages: [wake],
      workItems: [work('work-1', 'in_progress'), work('work-2', 'pending')],
      attempts: [attempt({ id: 'attempt-2', workItemId: 'work-2' })],
      dependencies: [
        { workItemId: 'work-2', dependsOnWorkItemId: 'work-1' },
      ],
    });
    expect(blocked).toBeNull();

    const ready = planner.plan({
      participantId: 'member-1',
      messages: [wake],
      workItems: [work('work-1', 'accepted'), work('work-2', 'pending')],
      attempts: [attempt({ id: 'attempt-2', workItemId: 'work-2' })],
      dependencies: [
        { workItemId: 'work-2', dependsOnWorkItemId: 'work-1' },
      ],
    });
    expect(ready?.activation.causes).toEqual([
      { type: 'assignment', workRef: 'W-2' },
    ]);
  });

  it('distinguishes semantic feedback from infrastructure retry by attempt number', () => {
    const wake = message('wake-2', 4, {
      kind: 'wake',
      workItemId: 'work-1',
      attemptId: 'attempt-2',
    });
    const plan = planner.plan({
      participantId: 'member-1',
      messages: [wake],
      workItems: [work('work-1', 'pending')],
      attempts: [attempt({ id: 'attempt-2', attemptNo: 2 })],
      dependencies: [],
    });
    expect(plan?.activation.causes).toEqual([
      { type: 'feedback', workRef: 'W-1' },
    ]);
  });
});
