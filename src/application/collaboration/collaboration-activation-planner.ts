import {
  messageRef,
  orderedWorkItems,
  workRef,
  type CollaborationActivation,
} from '../../domain/collaboration/collaboration.js';
import type { TeamMessage } from '../../domain/teams/team-message.js';
import type { TeamWorkDependency } from '../../domain/teams/team-work-dependency.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';

export interface PlannedCollaborationActivation {
  readonly activation: CollaborationActivation;
  readonly primaryWorkMessage: TeamMessage | null;
  readonly workAttempt: TeamWorkItemAttempt | null;
  readonly directMessages: readonly TeamMessage[];
}

/**
 * Pure collaboration scheduler policy. It only reads durable facts and returns
 * an activation intent; it never creates Tasks/Runs or calls an Execution Plane.
 */
export class CollaborationActivationPlanner {
  public plan(input: {
    readonly participantId: string;
    readonly messages: readonly TeamMessage[];
    readonly workItems: readonly TeamWorkItem[];
    readonly attempts: readonly TeamWorkItemAttempt[];
    readonly dependencies: readonly TeamWorkDependency[];
  }): PlannedCollaborationActivation | null {
    const queued = [...input.messages]
      .filter(
        (message) =>
          message.recipientMemberRunId === input.participantId &&
          message.status === 'queued',
      )
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
    if (!queued.length) return null;

    const workById = new Map(input.workItems.map((item) => [item.id, item]));
    const attemptsById = new Map(input.attempts.map((attempt) => [attempt.id, attempt]));
    const primaryWorkMessage = queued.find((message) => {
      if (message.kind === 'direct' || !message.attemptId) return false;
      const attempt = attemptsById.get(message.attemptId);
      if (
        !attempt ||
        attempt.assigneeMemberId !== input.participantId ||
        attempt.status !== 'queued' ||
        attempt.executionTaskId
      )
        return false;
      const work = workById.get(attempt.workItemId);
      if (!work || work.status !== 'pending') return false;
      return input.dependencies
        .filter((edge) => edge.workItemId === work.id)
        .every(
          (edge) => workById.get(edge.dependsOnWorkItemId)?.status === 'accepted',
        );
    }) ?? null;
    const workAttempt = primaryWorkMessage?.attemptId
      ? attemptsById.get(primaryWorkMessage.attemptId) ?? null
      : null;
    const directMessages = queued.filter((message) => message.kind === 'direct');
    if (!primaryWorkMessage && !directMessages.length) return null;

    const orderedWork = orderedWorkItems(input.workItems);
    const refForWorkId = (id: string) => {
      const index = orderedWork.findIndex((item) => item.id === id);
      return index < 0 ? null : workRef(index);
    };
    const causes: CollaborationActivation['causes'][number][] = [];
    if (workAttempt) {
      const ref = refForWorkId(workAttempt.workItemId);
      if (ref)
        causes.push({
          type: workAttempt.attemptNo > 1 ? 'feedback' : 'assignment',
          workRef: ref,
        });
    }
    for (const message of directMessages)
      causes.push({ type: 'message', messageRef: messageRef(message.sequence) });

    const priority = directMessages.some((message) => message.priority === 'urgent')
      ? 'urgent'
      : 'normal';
    const stableIds = [
      ...(primaryWorkMessage ? [primaryWorkMessage.id] : []),
      ...directMessages.map((message) => message.id),
    ].sort();
    return {
      activation: {
        participantId: input.participantId,
        causes,
        priority,
        dedupeKey: `collaboration:${input.participantId}:${stableIds.join(':')}`,
      },
      primaryWorkMessage,
      workAttempt,
      directMessages,
    };
  }
}
