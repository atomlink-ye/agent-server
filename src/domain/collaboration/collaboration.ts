import type { TeamMessage } from '../teams/team-message.js';
import type { TeamWorkItem } from '../teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../teams/team-work-item-attempt.js';

export type CollaborationBoardStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'submitted'
  | 'accepted'
  | 'cancelled';

export type CollaborationCapability =
  | 'board.read'
  | 'board.create'
  | 'board.assign'
  | 'board.claim'
  | 'board.checkpoint'
  | 'board.block'
  | 'board.submit'
  | 'board.review'
  | 'board.cancel'
  | 'mailbox.read'
  | 'mailbox.send'
  | 'mailbox.ack'
  | 'run.finalize';

export interface CollaborationBoardItem {
  readonly ref: string;
  readonly collaborationRunId: string;
  readonly subject: string;
  readonly description: string | null;
  readonly status: CollaborationBoardStatus;
  readonly ownerParticipantId: string | null;
  readonly createdByParticipantId: string;
  readonly dependencyRefs: readonly string[];
  readonly latestAttemptNo: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CollaborationMessageStatus =
  | 'pending'
  | 'presented'
  | 'acknowledged'
  | 'cancelled';

export type CollaborationActivationPriority = 'normal' | 'urgent';

export interface CollaborationMessage {
  readonly ref: string;
  readonly collaborationRunId: string;
  readonly fromParticipantId: string | null;
  readonly toParticipantId: string;
  readonly body: string;
  readonly aboutWorkRef: string | null;
  readonly replyToRef: string | null;
  readonly priority: CollaborationActivationPriority;
  readonly requiresAck: boolean;
  readonly status: CollaborationMessageStatus;
  readonly presentedByTaskId: string | null;
  readonly createdAt: string;
  readonly acknowledgedAt: string | null;
}

export interface CollaborationCheckpoint {
  readonly id: string;
  readonly collaborationRunId: string;
  readonly workItemId: string;
  readonly participantId: string;
  readonly summary: string;
  readonly nextStep: string | null;
  readonly blocker: string | null;
  readonly evidenceRefs: readonly string[];
  readonly createdAt: string;
}

export interface CollaborationSubmission {
  readonly id: string;
  readonly collaborationRunId: string;
  readonly workItemId: string;
  readonly attemptNo: number;
  readonly submittedByParticipantId: string;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly createdAt: string;
}

export type CollaborationActivationCause =
  | { readonly type: 'assignment'; readonly workRef: string }
  | { readonly type: 'claim'; readonly workRef: string }
  | { readonly type: 'message'; readonly messageRef: string }
  | { readonly type: 'feedback'; readonly workRef: string }
  | { readonly type: 'dependency_unblocked'; readonly workRef: string }
  | { readonly type: 'final_review' }
  | { readonly type: 'work_available'; readonly workRef: string };

export interface CollaborationActivation {
  readonly participantId: string;
  readonly causes: readonly CollaborationActivationCause[];
  readonly priority: CollaborationActivationPriority;
  readonly dedupeKey: string;
}

export function workRef(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0)
    throw new Error('Collaboration work index is invalid.');
  return `W-${index + 1}`;
}

export function messageRef(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence <= 0)
    throw new Error('Collaboration message sequence is invalid.');
  return `M-${sequence}`;
}

export function resolveWorkRef(
  ref: string,
  items: readonly TeamWorkItem[],
): TeamWorkItem | null {
  const match = /^W-(\d+)$/.exec(ref.trim());
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return orderedWorkItems(items)[index] ?? null;
}

export function resolveMessageRef(
  ref: string,
  messages: readonly TeamMessage[],
): TeamMessage | null {
  const match = /^M-(\d+)$/.exec(ref.trim());
  if (!match) return null;
  const sequence = Number(match[1]);
  return messages.find((message) => message.sequence === sequence) ?? null;
}

export function orderedWorkItems(
  items: readonly TeamWorkItem[],
): readonly TeamWorkItem[] {
  return [...items].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export function projectBoardStatus(
  item: TeamWorkItem,
  attempts: readonly TeamWorkItemAttempt[],
): CollaborationBoardStatus {
  if (item.status === 'accepted') return 'accepted';
  if (item.status === 'cancelled') return 'cancelled';
  if (item.status === 'blocked') return 'blocked';
  if (item.status === 'open') return 'open';
  const latest = attempts
    .filter((attempt) => attempt.workItemId === item.id)
    .sort((left, right) => right.attemptNo - left.attemptNo)[0];
  if (latest?.status === 'completed' && latest.resultSummary) return 'submitted';
  if (item.status === 'in_progress') return 'in_progress';
  if (item.ownerMemberId) return 'assigned';
  return 'open';
}

export function projectMessageStatus(
  message: TeamMessage & {
    readonly acknowledgedAt?: string | null;
    readonly cancelledAt?: string | null;
  },
): CollaborationMessageStatus {
  if (message.cancelledAt) return 'cancelled';
  if (message.acknowledgedAt) return 'acknowledged';
  return message.status === 'queued' ? 'pending' : 'presented';
}
