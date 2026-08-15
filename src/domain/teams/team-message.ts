import { randomUUID } from 'node:crypto';

export type TeamMessageStatus =
  | 'queued'
  | 'consumed'
  | 'delivered'
  | 'read'
  | 'acknowledged'
  | 'cancelled';
export type TeamMessageKind = 'wake' | 'work_update' | 'direct';
export type TeamMessagePriority = 'normal' | 'urgent';

export interface TeamMessage {
  readonly id: string;
  readonly teamRunId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly sequence: number;
  readonly senderMemberRunId: string | null;
  readonly recipientMemberRunId: string;
  readonly workItemId: string | null;
  readonly attemptId: string | null;
  readonly aboutWorkItemId: string | null;
  readonly replyToMessageId: string | null;
  readonly kind: TeamMessageKind;
  readonly dedupKey: string;
  readonly body: string;
  readonly priority: TeamMessagePriority;
  readonly requiresAck: boolean;
  readonly status: TeamMessageStatus;
  readonly consumedByTaskId: string | null;
  readonly sourceTaskId: string | null;
  readonly sourceRunId: string | null;
  readonly createdAt: string;
  readonly consumedAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly cancelledAt: string | null;
}

export interface CreateTeamMessageOptions {
  readonly id?: string;
  readonly teamRunId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly senderMemberRunId?: string | null;
  readonly recipientMemberRunId: string;
  readonly workItemId?: string | null;
  readonly attemptId?: string | null;
  readonly aboutWorkItemId?: string | null;
  readonly replyToMessageId?: string | null;
  readonly kind: TeamMessageKind;
  readonly dedupKey: string;
  readonly body: string;
  readonly priority?: TeamMessagePriority;
  readonly requiresAck?: boolean;
  readonly sourceTaskId?: string | null;
  readonly sourceRunId?: string | null;
  readonly now?: () => Date;
}

export function createTeamMessage(
  options: CreateTeamMessageOptions,
): TeamMessage {
  const body = options.body.trim();
  const dedupKey = options.dedupKey.trim();
  if (!body || body.length > 16_384)
    throw new Error('Team message body is invalid.');
  if (!dedupKey || dedupKey.length > 512)
    throw new Error('Team message dedup key is invalid.');
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    id: options.id ?? randomUUID(),
    teamRunId: options.teamRunId,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId,
    principalType: options.principalType,
    principalId: options.principalId,
    sequence: 0,
    senderMemberRunId: options.senderMemberRunId ?? null,
    recipientMemberRunId: options.recipientMemberRunId,
    workItemId: options.workItemId ?? null,
    attemptId: options.attemptId ?? null,
    aboutWorkItemId: options.aboutWorkItemId ?? options.workItemId ?? null,
    replyToMessageId: options.replyToMessageId ?? null,
    kind: options.kind,
    dedupKey,
    body,
    priority: options.priority ?? 'normal',
    requiresAck: options.requiresAck ?? false,
    status: 'queued',
    consumedByTaskId: null,
    sourceTaskId: options.sourceTaskId ?? null,
    sourceRunId: options.sourceRunId ?? null,
    createdAt,
    consumedAt: null,
    acknowledgedAt: null,
    cancelledAt: null,
  });
}
