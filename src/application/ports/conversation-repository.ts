import type {
  Conversation,
  ConversationMember,
} from '../../domain/chat/conversation.js';
import type { ChatMessage } from '../../domain/chat/chat-message.js';
import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';

export type ConversationMessageAuthorContext =
  | {
      readonly type: 'principal';
      readonly tenantId: string;
      readonly conversationId: string;
      readonly principalType: string;
      readonly principalId: string;
      /** Trusted turn metadata supplied by the server-side admission path. */
      readonly turnMetadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'agent_definition';
      readonly tenantId: string;
      readonly conversationId: string;
      readonly agentDefinitionId: string;
      readonly agentVersionId?: string | null;
      readonly runtimeEpoch?: number | null;
      /** Trusted turn metadata supplied by the server-side runtime path. */
      readonly turnMetadata?: Readonly<Record<string, unknown>>;
    };

export interface ConversationRepository {
  findOrCreateDirect(input: {
    readonly tenantId: string;
    readonly principalId: string;
    readonly principalType: string;
    readonly agentDefinitionId: string;
  }): Promise<Conversation>;

  getConversation(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly requesterMemberType: 'principal' | 'agent_definition';
    readonly requesterMemberId: string;
  }): Promise<Conversation | null>;

  listConversations(input: {
    readonly tenantId: string;
    readonly memberType: 'principal' | 'agent_definition';
    readonly memberId: string;
  }): Promise<readonly Conversation[]>;

  appendMessage(input: {
    readonly author: ConversationMessageAuthorContext;
    readonly body: string;
    readonly workRef?: string | null;
  }): Promise<ChatMessage>;

  listMessages(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly afterSequence?: number;
  }): Promise<readonly ChatMessage[]>;

  getUnread(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<{ readonly lastReadSequence: number; readonly unreadCount: number }>;

  markRead(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly throughSequence: number;
  }): Promise<void>;

  ensureChatRuntime(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly activeAgentVersionId: string;
  }): Promise<AgentChatRuntime>;

  rotateChatRuntimeEpoch(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
    readonly newVersionId: string;
  }): Promise<AgentChatRuntime>;

  getChatRuntime(input: {
    readonly tenantId: string;
    readonly agentDefinitionId: string;
  }): Promise<AgentChatRuntime | null>;
}
