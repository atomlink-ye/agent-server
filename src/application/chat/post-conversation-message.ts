import type { ChatMessage } from '../../domain/chat/chat-message.js';
import type {
  ConversationMessageAuthorContext,
  ConversationRepository,
} from '../ports/conversation-repository.js';

// Durable-first: only writes chat_messages. No Task/Run/run_dispatches — that is the Work form's path, not this one.
export async function postConversationMessage(
  repo: ConversationRepository,
  input: {
    readonly author: ConversationMessageAuthorContext;
    readonly body: string;
    readonly workRef?: string | null;
  },
): Promise<ChatMessage> {
  return repo.appendMessage(input);
}
