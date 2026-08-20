import type { ChatWorkCard } from '../product-projection/chat-work-card-projection.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
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

export interface WorkChatWakeDeliveryDependencies {
  readonly conversations: Pick<
    ConversationRepository,
    'appendMessage' | 'getChatRuntime'
  >;
  readonly agentDefinitions: WorkChatConversationAgentDefinitionResolver;
}

/**
 * Durable append adapter for a claimed wake. It deliberately uses getChatRuntime
 * rather than ensureChatRuntime: a missing or unavailable runtime is a failed
 * delivery and must remain lease-retryable.
 */
export function createWorkChatWakeDelivery(
  dependencies: WorkChatWakeDeliveryDependencies,
): WorkChatWakeDeliveryPort {
  return {
    async deliver(delivery) {
      const agentDefinitionId = await dependencies.agentDefinitions.resolve({
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
        workId: delivery.workId,
        conversationId: delivery.conversationId,
      });
      if (!agentDefinitionId) {
        throw new Error('Work Chat wake agent definition is unavailable.');
      }

      const runtime = await dependencies.conversations.getChatRuntime({
        tenantId: delivery.tenantId,
        agentDefinitionId,
      });
      if (
        !runtime ||
        runtime.tenantId !== delivery.tenantId ||
        runtime.agentDefinitionId !== agentDefinitionId ||
        runtime.status !== 'available' ||
        !runtime.activeAgentVersionId ||
        !Number.isSafeInteger(runtime.epoch) ||
        runtime.epoch <= 0
      ) {
        throw new Error('Work Chat wake runtime is unavailable.');
      }

      await dependencies.conversations.appendMessage({
        author: {
          type: 'agent_definition',
          tenantId: delivery.tenantId,
          conversationId: delivery.conversationId,
          agentDefinitionId,
          agentVersionId: runtime.activeAgentVersionId,
          runtimeEpoch: runtime.epoch,
          turnMetadata: {
            kind: 'work_chat_wake',
            deliveryId: delivery.deliveryId,
          },
        },
        body: workChatWakeBody(delivery.card),
        workRef: delivery.card.workRef,
        deliveryId: delivery.deliveryId,
      });
    },
  };
}

function workChatWakeBody(card: WorkChatWakeDelivery['card']): string {
  const title = compact(card.title);
  switch (card.productState) {
    case 'complete':
      return card.resultSummary
        ? `Work ${card.workRef} completed: ${compact(card.resultSummary)}`
        : `Work ${card.workRef} completed: ${title}`;
    case 'needs_you':
      return `Work ${card.workRef} needs your attention: ${title}`;
    case 'problem':
      return `Work ${card.workRef} encountered a problem: ${title}`;
    default:
      throw new Error('Work Chat wake state is not deliverable.');
  }
}

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 239)}…` : normalized;
}
