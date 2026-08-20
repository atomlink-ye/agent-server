import type { ProductState } from '../../contracts/product-projection/index.js';
import type { ChatWorkCard } from '../product-projection/chat-work-card-projection.js';
import type { WorkChatWakeDelivery } from './work-chat-wake-delivery.js';

export interface WorkChatWakeWorkKey {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
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
  markDelivered(deliveryId: string, workerId: string): Promise<void>;
}
