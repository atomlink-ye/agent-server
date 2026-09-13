import type { ConversationRepository } from '../ports/conversation-repository.js';

export interface TerminalChatDeliveryFailure {
  readonly dispatchId: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly agentDefinitionId: string;
  readonly throughSequence: number;
}

const TERMINAL_FAILURE_MESSAGE =
  "I couldn't complete that reply because the execution service became unavailable. Please send your message again to retry.";

/** Materializes a safe, idempotent terminal reply for a parked Chat activation. */
export async function materializeChatDeliveryFailure(
  conversations: Pick<ConversationRepository, 'appendMessage'>,
  failure: TerminalChatDeliveryFailure,
): Promise<void> {
  await conversations.appendMessage({
    author: {
      type: 'agent_definition',
      tenantId: failure.tenantId,
      conversationId: failure.conversationId,
      agentDefinitionId: failure.agentDefinitionId,
      agentVersionId: null,
      runtimeEpoch: null,
      provider: null,
      turnMetadata: {
        kind: 'chat_activation_failure',
        dispatchId: failure.dispatchId,
        throughSequence: failure.throughSequence,
      },
    },
    body: TERMINAL_FAILURE_MESSAGE,
    deliveryId: `chat-reply-failure:${failure.dispatchId}`,
  });
}
