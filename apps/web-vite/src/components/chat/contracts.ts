export type ConversationId = string;

export type WorkListProductState =
  | 'running'
  | 'needs_you'
  | 'complete'
  | 'problem'
  | 'not_captured';

export interface WorkListItem {
  readonly id: string;
  readonly title: string;
  readonly productState: WorkListProductState;
  readonly updatedAt: string;
  readonly latestRunSummary: {
    readonly id: string;
    readonly updatedAt: string;
    readonly resultSummary: string | null;
    readonly resultCaptureStatus: string;
  } | null;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly kind: 'direct' | 'group';
  readonly title: string | null;
  readonly directAgent: {
    readonly agentDefinitionId: string;
    readonly displayName: string | null;
  } | null;
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
  readonly createConversation: (
    agentDefinitionId: string,
  ) => Promise<Conversation>;
  readonly loadWorks: () => Promise<readonly WorkListItem[]>;
  readonly loadMessages: (
    conversationId: ConversationId,
  ) => Promise<readonly ChatMessage[]>;
  readonly sendMessage: (
    conversationId: ConversationId,
    body: string,
  ) => Promise<ChatMessage>;
}
