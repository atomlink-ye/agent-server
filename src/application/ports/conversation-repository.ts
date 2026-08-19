import type {
  Conversation,
  ConversationMember,
} from '../../domain/chat/conversation.js';
import type { ChatMessage } from '../../domain/chat/chat-message.js';
import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';

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
    readonly tenantId: string;
    readonly conversationId: string;
    readonly authorType: 'principal' | 'agent_definition';
    readonly authorId: string;
    readonly body: string;
    readonly agentDefinitionId?: string | null;
    readonly agentVersionId?: string | null;
    readonly runtimeEpoch?: number | null;
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
}
