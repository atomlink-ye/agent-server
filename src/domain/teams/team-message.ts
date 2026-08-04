import { randomUUID } from 'node:crypto';

export type TeamMessageStatus = 'queued' | 'consumed' | 'delivered' | 'read';
export type TeamMessageKind = 'wake' | 'work_update' | 'direct';

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
  readonly kind: TeamMessageKind;
  readonly dedupKey: string;
  readonly body: string;
  readonly status: TeamMessageStatus;
  readonly consumedByTaskId: string | null;
  readonly createdAt: string;
  readonly consumedAt: string | null;
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
  readonly kind: TeamMessageKind;
  readonly dedupKey: string;
  readonly body: string;
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
    kind: options.kind,
    dedupKey,
    body,
    status: 'queued',
    consumedByTaskId: null,
    createdAt,
    consumedAt: null,
  });
}
