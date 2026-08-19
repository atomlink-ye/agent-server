import type { ChatMessage } from '../../domain/chat/chat-message.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';

// Durable-first: only writes chat_messages. No Task/Run/run_dispatches — that is the Work form's path, not this one.
export async function postConversationMessage(
  repo: ConversationRepository,
  input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly authorType: 'principal' | 'agent_definition';
    readonly authorId: string;
    readonly body: string;
    readonly agentDefinitionId?: string | null;
    readonly agentVersionId?: string | null;
    readonly runtimeEpoch?: number | null;
    readonly workRef?: string | null;
  },
): Promise<ChatMessage> {
  return repo.appendMessage(input);
}
