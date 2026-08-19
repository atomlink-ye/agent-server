import type { ChatActivation } from '../../domain/chat/chat-activation.js';

/**
 * Pure message scheduler for chat-based agent activation.
 * Reads a snapshot of conversation state (read tracking + message metadata)
 * and returns activation intent only; no side effects, no I/O.
 * Matches the contract of CollaborationActivationPlanner for consistency.
 */
export class ChatActivationPlanner {
  public plan(input: {
    readonly agentDefinitionId: string;
    readonly conversationId: string;
    readonly lastReadSequence: number;
    readonly latestMessageSequence: number;
    readonly latestMessageAuthorType: 'principal' | 'agent_definition';
  }): ChatActivation | null {
    // Agent's own messages do not activate itself.
    if (input.latestMessageAuthorType === 'agent_definition') {
      return null;
    }

    // No unread messages.
    if (input.latestMessageSequence <= input.lastReadSequence) {
      return null;
    }

    return {
      agentDefinitionId: input.agentDefinitionId,
      causes: [
        {
          type: 'unread_message',
          conversationId: input.conversationId,
          throughSequence: input.latestMessageSequence,
        },
      ],
      priority: 'normal',
      dedupeKey: `chat:${input.agentDefinitionId}:${input.conversationId}:${input.latestMessageSequence}`,
    };
  }
}
