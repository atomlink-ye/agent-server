import type { Conversation } from '../../domain/chat/conversation.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';

export async function findOrCreateDirectConversation(
  repo: ConversationRepository,
  input: {
    readonly tenantId: string;
    readonly principalId: string;
    readonly principalType: string;
    readonly agentDefinitionId: string;
  },
): Promise<Conversation> {
  return repo.findOrCreateDirect(input);
}
