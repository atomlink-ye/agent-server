import { randomUUID } from 'node:crypto';
import type { WorkChatRepository } from '../ports/work-chat-repository.js';
import type { WorkChatOwner } from '../ports/work-chat-repository.js';

export class WorkChatNotFoundError extends Error {
  public constructor() {
    super('The requested Work was not found.');
    this.name = 'WorkChatNotFoundError';
  }
}

export class WorkChatService {
  public constructor(private readonly repository: WorkChatRepository) {}

  public list(input: Parameters<WorkChatRepository['list']>[0]) {
    return this.repository.list(input);
  }

  public async post(input: {
    readonly owner: WorkChatOwner;
    readonly workId: string;
    readonly workRunId?: string | undefined;
    readonly body: string;
    readonly clientRequestId: string;
    readonly now?: string;
  }) {
    const body = input.body.trim();
    if (!body || body.length > 16_384)
      throw new Error('Work Chat message must contain 1-16384 characters.');
    if (!input.clientRequestId.trim() || input.clientRequestId.length > 200)
      throw new Error('Work Chat client request id is invalid.');
    return this.repository.enqueue({
      owner: input.owner,
      workId: input.workId,
      workRunId: input.workRunId,
      id: randomUUID(),
      body,
      clientRequestId: input.clientRequestId,
      createdAt: input.now ?? new Date().toISOString(),
    });
  }

  public retry(input: {
    readonly owner: WorkChatOwner;
    readonly workId: string;
    readonly workRunId?: string | undefined;
    readonly messageId: string;
    readonly now?: string;
  }) {
    return this.repository.retry({
      id: input.messageId,
      owner: input.owner,
      workId: input.workId,
      workRunId: input.workRunId,
      updatedAt: input.now ?? new Date().toISOString(),
    });
  }
}
