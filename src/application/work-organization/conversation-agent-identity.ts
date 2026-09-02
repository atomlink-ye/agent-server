/**
 * Who a chat-runtime tool call belongs to.
 *
 * A chat runtime session's scope id is the AgentChatRuntime id, not the
 * AgentDefinition id, so the claimant cannot be read off the grant. The
 * conversation's `agent_definition` member is the established way to recover it
 * (see WorkChatConversationAgentDefinitionResolver).
 */
export interface ConversationAgentIdentityResolver {
  resolve(input: {
    readonly tenantId: string;
    readonly conversationId: string;
  }): Promise<string | null>;
}
