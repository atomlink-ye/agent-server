export type ConversationId = string;

export interface Conversation {
  readonly id: ConversationId;
  readonly title: string | null;
  readonly updatedAt: string;
}

export type ChatAuthorType = 'principal' | 'agent_definition';

export interface ChatMessage {
  readonly id: string;
  readonly conversationId: ConversationId;
  readonly sequence: number;
  readonly authorType: ChatAuthorType;
  readonly authorId: string;
  readonly body: string;
  readonly workRef: string | null;
  readonly createdAt: string;
}

export interface ChatCommands {
  readonly loadConversations: () => Promise<readonly Conversation[]>;
  readonly loadMessages: (
    conversationId: ConversationId,
  ) => Promise<readonly ChatMessage[]>;
  readonly sendMessage: (
    conversationId: ConversationId,
    body: string,
  ) => Promise<ChatMessage>;
}
