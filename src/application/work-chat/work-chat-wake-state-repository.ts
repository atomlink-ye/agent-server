import type { ChatWorkCard } from '../product-projection/chat-work-card-projection.js';
import type { ChatDispatchRepository } from '../ports/chat-dispatch-repository.js';
import type { WorkChatWakeDelivery } from './work-chat-wake-delivery.js';

export interface WorkChatWakeWorkKey {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
}

export type WorkChatWakeCursor = WorkChatWakeWorkKey;

export interface WorkChatWakeWorkPage {
  readonly items: readonly WorkChatWakeWorkKey[];
  readonly nextCursor: WorkChatWakeCursor | null;
}

export interface WorkChatWakeStateRepository {
  observe(input: {
    readonly key: WorkChatWakeWorkKey;
    readonly card: ChatWorkCard;
    readonly conversationId: string | null;
    readonly observedAt: string;
  }): Promise<'unchanged' | 'recorded' | 'queued'>;
  claimPending(
    workerId: string,
    leaseMs: number,
  ): Promise<WorkChatWakeDelivery | null>;
  /** Same durable activation queue used by ordinary Conversation messages. */
  enqueueChatActivation(
    input: Parameters<ChatDispatchRepository['enqueue']>[0],
  ): ReturnType<ChatDispatchRepository['enqueue']>;
  markDelivered(deliveryId: string, workerId: string): Promise<void>;
}
