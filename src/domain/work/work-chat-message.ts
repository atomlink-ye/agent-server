export type WorkChatMessageKind = 'user' | 'lead' | 'system';
export type WorkChatMessageStatus =
  'queued' | 'processing' | 'replied' | 'failed';

export interface WorkChatMessage {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
  readonly preparationId?: string | null;
  readonly workRunId?: string | null;
  readonly sequence: number;
  readonly kind: WorkChatMessageKind;
  readonly body: string;
  readonly status: WorkChatMessageStatus;
  readonly replyToMessageId: string | null;
  readonly clientRequestId: string | null;
  readonly leaseOwner: string | null;
  readonly leaseFence: number;
  readonly leaseExpiresAt: string | null;
  readonly attemptCount: number;
  readonly sourceRuntimeTurnId: string | null;
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
