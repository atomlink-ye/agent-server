import { describe, expect, it } from 'vitest';
import type { WorkChatRepository } from '../ports/work-chat-repository.js';
import type { WorkChatMessage } from '../../domain/work/work-chat-message.js';
import { WorkChatService } from './work-chat-service.js';

const owner = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account',
  principalId: 'account',
} as const;

describe('WorkChatService', () => {
  it('assigns one server request to one monotonic message sequence and replays idempotently', async () => {
    const repository = new MemoryWorkChatRepository();
    const service = new WorkChatService(repository);
    const first = await service.post({
      owner,
      workId: 'work',
      body: 'first',
      clientRequestId: 'request-1',
      now: '2026-01-01T00:00:00.000Z',
    });
    const replay = await service.post({
      owner,
      workId: 'work',
      body: 'first',
      clientRequestId: 'request-1',
      now: '2026-01-01T00:00:01.000Z',
    });
    const second = await service.post({
      owner,
      workId: 'work',
      body: 'second',
      clientRequestId: 'request-2',
      now: '2026-01-01T00:00:02.000Z',
    });
    expect(first.message.sequence).toBe(1);
    expect(replay).toEqual({ message: first.message, replayed: true });
    expect(second.message.sequence).toBe(2);
    expect(repository.messages.map((message) => message.sequence)).toEqual([
      1, 2,
    ]);
  });
});

class MemoryWorkChatRepository implements WorkChatRepository {
  readonly messages: WorkChatMessage[] = [];
  async list(input: { workId: string }) {
    return this.messages.filter((message) => message.workId === input.workId);
  }
  async enqueue(input: Parameters<WorkChatRepository['enqueue']>[0]) {
    const existing = this.messages.find(
      (message) =>
        message.workId === input.workId &&
        message.clientRequestId === input.clientRequestId,
    );
    if (existing) return { message: existing, replayed: true };
    const message: WorkChatMessage = {
      id: input.id,
      tenantId: input.owner.tenantId,
      workspaceId: input.owner.workspaceId,
      workId: input.workId,
      sequence:
        this.messages.filter((item) => item.workId === input.workId).length + 1,
      kind: 'user',
      body: input.body,
      status: 'queued',
      replyToMessageId: null,
      clientRequestId: input.clientRequestId,
      leaseOwner: null,
      leaseFence: 0,
      leaseExpiresAt: null,
      attemptCount: 0,
      sourceRuntimeTurnId: null,
      failureCode: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.messages.push(message);
    return { message, replayed: false };
  }
  async claimNext(): Promise<never> {
    throw new Error('not used');
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async fail(): Promise<never> {
    throw new Error('not used');
  }
  async retry(): Promise<never> {
    throw new Error('not used');
  }
}
