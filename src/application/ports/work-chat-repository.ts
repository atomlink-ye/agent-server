import type { WorkChatMessage } from '../../domain/work/work-chat-message.js';

export interface WorkChatOwner {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
}

export interface WorkChatClaim extends WorkChatMessage {
  readonly leaseOwner: string;
  readonly leaseFence: number;
}

export interface WorkChatRepository {
  list(input: {
    readonly owner: WorkChatOwner;
    readonly workId: string;
    readonly workRunId?: string | undefined;
    readonly limit?: number;
  }): Promise<readonly WorkChatMessage[]>;
  enqueue(input: {
    readonly owner: WorkChatOwner;
    readonly workId: string;
    readonly workRunId?: string | undefined;
    readonly id: string;
    readonly body: string;
    readonly clientRequestId: string;
    readonly createdAt: string;
  }): Promise<{
    readonly message: WorkChatMessage;
    readonly replayed: boolean;
  }>;
  claimNext(input: {
    readonly workerId: string;
    readonly leaseMs: number;
    readonly now: string;
  }): Promise<WorkChatClaim | null>;
  complete(input: {
    readonly id: string;
    readonly workerId: string;
    readonly leaseFence: number;
    readonly reply: {
      readonly id: string;
      readonly body: string;
      readonly sourceRuntimeTurnId: string | null;
      readonly createdAt: string;
    };
    readonly updatedAt: string;
  }): Promise<WorkChatMessage | false>;
  fail(input: {
    readonly id: string;
    readonly workerId: string;
    readonly leaseFence: number;
    readonly failureCode: string;
    readonly updatedAt: string;
  }): Promise<WorkChatMessage | false>;
  retry(input: {
    readonly id: string;
    readonly owner: WorkChatOwner;
    readonly workId: string;
    readonly workRunId?: string | undefined;
    readonly updatedAt: string;
  }): Promise<WorkChatMessage | false>;
}

export class WorkChatRequestConflictError extends Error {
  public constructor() {
    super('The client request key belongs to another conversation or message.');
    this.name = 'WorkChatRequestConflictError';
  }
}

export class WorkChatRunRequiredError extends Error {
  public constructor() {
    super('This Work has Runs. Select a Run to continue the conversation.');
    this.name = 'WorkChatRunRequiredError';
  }
}
