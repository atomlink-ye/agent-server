import type { ChatWorkCard } from '../product-projection/chat-work-card-projection.js';
import type { WorkChatWakeWorkKey } from './work-chat-wake-state-repository.js';

/** Safe, product-level payload handed to the authorized Chat adapter. */
export interface WorkChatWakeDelivery extends WorkChatWakeWorkKey {
  /** Internal idempotency key; never render this to a user. */
  readonly deliveryId: string;
  readonly conversationId: string;
  readonly card: Pick<
    ChatWorkCard,
    | 'workId'
    | 'workRef'
    | 'title'
    | 'productState'
    | 'problemKind'
    | 'attentionReason'
    | 'resultSummary'
    | 'resultCaptureStatus'
  >;
  readonly observedAt: string;
}

/**
 * Lane 1 supplies this grant-derived, idempotent adapter. It must derive the
 * agent/runtime identity server-side and complete only after durable append.
 */
export interface WorkChatWakeDeliveryPort {
  deliver(delivery: WorkChatWakeDelivery): Promise<void>;
}

/**
 * Server-side identity lookup for the agent member of a linked conversation.
 * The lookup is for author/runtime identity only; appendMessage remains the
 * authoritative, transactional membership check.
 */
export interface WorkChatConversationAgentDefinitionResolver {
  resolve(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
    readonly conversationId: string;
  }): Promise<string | null>;
}
