import { describe, expect, it } from 'vitest';

import { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';
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

function work(
  id: string,
  status: TeamWorkItem['status'],
  input: Partial<TeamWorkItem> = {},
): TeamWorkItem {
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
    ...input,
  };
}

function attempt(
  input: Partial<TeamWorkItemAttempt> = {},
): TeamWorkItemAttempt {
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
  it('coalesces one assignment with urgent-first bounded mailbox delivery', () => {
    const workWake = message('wake-1', 1, {
      kind: 'wake',
      workItemId: 'work-1',
      attemptId: 'attempt-1',
    });
    const normalMessages = Array.from(
      { length: COLLABORATION_LIMITS.maxMessagesPerActivation },
      (_, index) => message(`message-${index + 2}`, index + 2),
    );
    const urgent = message('message-urgent', 99, { priority: 'urgent' });
    const plan = planner.plan({
      participantId: 'member-1',
      participantRole: 'member',
      messages: [workWake, ...normalMessages, urgent],
      workItems: [work('work-1', 'pending')],
      attempts: [attempt()],
      dependencies: [],
    });

    expect(plan).not.toBeNull();
    expect(plan!.activation.causes[0]).toEqual({
      type: 'assignment',
      workRef: 'W-1',
    });
    expect(plan!.activation.causes[1]).toEqual({
      type: 'message',
      messageRef: 'M-99',
    });
    expect(plan!.activation.priority).toBe('urgent');
    expect(plan!.directMessages).toHaveLength(
      COLLABORATION_LIMITS.maxMessagesPerActivation,
    );
    expect(plan!.directMessages.at(-1)?.sequence).toBe(
      COLLABORATION_LIMITS.maxMessagesPerActivation,
    );
  });

  it('plans a queued assignment from durable work facts even if its wake message is missing', () => {
    const plan = planner.plan({
      participantId: 'member-1',
      participantRole: 'member',
      messages: [],
      workItems: [work('work-1', 'pending')],
      attempts: [attempt()],
      dependencies: [],
    });
    expect(plan?.activation.causes).toEqual([
      { type: 'assignment', workRef: 'W-1' },
    ]);
  });

  it('does not activate dependency-blocked work until dependencies are accepted', () => {
    const blocked = planner.plan({
      participantId: 'member-1',
      participantRole: 'member',
      messages: [],
      workItems: [work('work-1', 'in_progress'), work('work-2', 'pending')],
      attempts: [attempt({ id: 'attempt-2', workItemId: 'work-2' })],
      dependencies: [{ workItemId: 'work-2', dependsOnWorkItemId: 'work-1' }],
    });
    expect(blocked).toBeNull();

    const ready = planner.plan({
      participantId: 'member-1',
      participantRole: 'member',
      messages: [],
      workItems: [work('work-1', 'accepted'), work('work-2', 'pending')],
      attempts: [attempt({ id: 'attempt-2', workItemId: 'work-2' })],
      dependencies: [{ workItemId: 'work-2', dependsOnWorkItemId: 'work-1' }],
    });
    expect(ready?.activation.causes).toEqual([
      { type: 'dependency_unblocked', workRef: 'W-2' },
    ]);
  });

  it('offers open actionable Work without assigning it implicitly', () => {
    const open = work('work-1', 'open');
    const plan = planner.plan({
      participantId: 'member-1',
      participantRole: 'member',
      teamRevision: 4,
      messages: [],
      workItems: [open],
      attempts: [],
      dependencies: [],
      workAvailableItem: open,
    });

    expect(plan?.activation.causes).toEqual([
      { type: 'work_available', workRef: 'W-1' },
    ]);
    expect(plan?.workAttempt).toBeNull();
    expect(plan?.workAvailableItem?.ownerMemberId).toBeNull();
  });

  it('plans Lead final review through the same participant activation contract', () => {
    const plan = planner.plan({
      participantId: 'lead-1',
      participantRole: 'lead',
      teamRevision: 7,
      messages: [],
      workItems: [work('work-1', 'accepted')],
      attempts: [
        attempt({
          status: 'completed',
          resultSummary: 'done',
          executionTaskId: 'task-1',
        }),
      ],
      dependencies: [],
      finalReview: true,
    });

    expect(plan?.activation.causes).toEqual([{ type: 'final_review' }]);
    expect(plan?.activation.dedupeKey).toContain('review:7');
  });

  it('distinguishes semantic feedback from infrastructure retry by attempt number', () => {
    const plan = planner.plan({
      participantId: 'member-1',
      participantRole: 'member',
      messages: [],
      workItems: [work('work-1', 'pending')],
      attempts: [attempt({ id: 'attempt-2', attemptNo: 2 })],
      dependencies: [],
    });
    expect(plan?.activation.causes).toEqual([
      { type: 'feedback', workRef: 'W-1' },
    ]);
  });
});
