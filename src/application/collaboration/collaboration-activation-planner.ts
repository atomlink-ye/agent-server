import {
  messageRef,
  orderedWorkItems,
  workRef,
  type CollaborationActivation,
} from '../../domain/collaboration/collaboration.js';
import { COLLABORATION_LIMITS } from '../../domain/collaboration/collaboration-policy-definition.js';
import type { TeamMessage } from '../../domain/teams/team-message.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { TeamWorkDependency } from '../ports/team-execution-repository.js';

export interface PlannedCollaborationActivation {
  readonly activation: CollaborationActivation;
  readonly primaryWorkMessage: TeamMessage | null;
  readonly workAttempt: TeamWorkItemAttempt | null;
  readonly workAvailableItem: TeamWorkItem | null;
  readonly directMessages: readonly TeamMessage[];
  readonly finalReview: boolean;
  readonly reviewFeedback: string | null;
}

/**
 * Pure participant scheduler policy. It reads a durable collaboration snapshot
 * and returns activation intent only; Task/Run creation and runtime delivery
 * remain separate concerns.
 */
export class CollaborationActivationPlanner {
  public plan(input: {
    readonly participantId: string;
    readonly participantRole?: 'lead' | 'member';
    readonly teamRevision?: number;
    readonly messages: readonly TeamMessage[];
    readonly workItems: readonly TeamWorkItem[];
    readonly attempts: readonly TeamWorkItemAttempt[];
    readonly dependencies: readonly TeamWorkDependency[];
    readonly workAvailableItem?: TeamWorkItem | null;
    readonly finalReview?: boolean;
    readonly reviewFeedback?: string | null;
  }): PlannedCollaborationActivation | null {
    const participantRole = input.participantRole ?? 'member';
    const queued = input.messages.filter(
      (message) =>
        message.recipientMemberRunId === input.participantId &&
        message.status === 'queued',
    );
    const directMessages = queued
      .filter((message) => message.kind === 'direct')
      .sort(
        (left, right) =>
          priorityRank(left.priority) - priorityRank(right.priority) ||
          left.sequence - right.sequence ||
          left.id.localeCompare(right.id),
      )
      .slice(0, COLLABORATION_LIMITS.maxMessagesPerActivation);

    const workById = new Map(input.workItems.map((item) => [item.id, item]));
    const queuedAttempts = input.attempts
      .filter(
        (attempt) =>
          attempt.assigneeMemberId === input.participantId &&
          attempt.status === 'queued' &&
          !attempt.executionTaskId,
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.attemptNo - right.attemptNo ||
          left.id.localeCompare(right.id),
      );
    const workAttempt =
      participantRole === 'member'
        ? queuedAttempts.find((attempt) => {
            const work = workById.get(attempt.workItemId);
            if (!work || work.status !== 'pending') return false;
            return dependenciesAccepted(
              work.id,
              input.dependencies,
              workById,
            );
          }) ?? null
        : null;
    const primaryWorkMessage = workAttempt
      ? queued.find(
          (message) =>
            message.kind !== 'direct' && message.attemptId === workAttempt.id,
        ) ?? null
      : null;

    const orderedWork = orderedWorkItems(input.workItems);
    const refForWorkId = (id: string) => {
      const index = orderedWork.findIndex((item) => item.id === id);
      return index < 0 ? null : workRef(index);
    };
    const causes: CollaborationActivation['causes'][number][] = [];
    if (workAttempt) {
      const ref = refForWorkId(workAttempt.workItemId);
      const hasDependencies = input.dependencies.some(
        (edge) => edge.workItemId === workAttempt.workItemId,
      );
      if (ref)
        causes.push(
          workAttempt.attemptNo > 1
            ? { type: 'feedback', workRef: ref }
            : hasDependencies
              ? { type: 'dependency_unblocked', workRef: ref }
              : { type: 'assignment', workRef: ref },
        );
    }

    const workAvailableItem =
      participantRole === 'member' &&
      !workAttempt &&
      input.workAvailableItem?.status === 'open' &&
      dependenciesAccepted(
        input.workAvailableItem.id,
        input.dependencies,
        workById,
      )
        ? input.workAvailableItem
        : null;
    if (workAvailableItem) {
      const ref = refForWorkId(workAvailableItem.id);
      if (ref) causes.push({ type: 'work_available', workRef: ref });
    }

    const finalReview = participantRole === 'lead' && input.finalReview === true;
    if (finalReview) causes.push({ type: 'final_review' });

    for (const message of directMessages)
      causes.push({ type: 'message', messageRef: messageRef(message.sequence) });

    if (!causes.length) return null;
    const priority = directMessages.some(
      (message) => message.priority === 'urgent',
    )
      ? 'urgent'
      : 'normal';
    const stableIds = [
      ...(workAttempt ? [`attempt:${workAttempt.id}`] : []),
      ...(workAvailableItem
        ? [`available:${workAvailableItem.id}:${workAvailableItem.updatedAt}`]
        : []),
      ...(finalReview ? [`review:${input.teamRevision ?? 0}`] : []),
      ...directMessages.map((message) => `message:${message.id}`),
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
      workAvailableItem,
      directMessages,
      finalReview,
      reviewFeedback: input.reviewFeedback ?? null,
    };
  }
}

function dependenciesAccepted(
  workItemId: string,
  dependencies: readonly TeamWorkDependency[],
  workById: ReadonlyMap<string, TeamWorkItem>,
): boolean {
  return dependencies
    .filter((edge) => edge.workItemId === workItemId)
    .every(
      (edge) => workById.get(edge.dependsOnWorkItemId)?.status === 'accepted',
    );
}

function priorityRank(priority: TeamMessage['priority']): number {
  return priority === 'urgent' ? 0 : 1;
}
