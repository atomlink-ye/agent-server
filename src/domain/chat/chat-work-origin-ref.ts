/**
 * Durable relationship between a Product Work and its originating
 * conversation. The relationship is scoped by the authenticated tenant and
 * workspace; it is not encoded in chat_messages.work_ref.
 */
export interface ConversationWorkLink {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
  readonly conversationId: string;
  readonly createdAt: string;
}

export interface ConversationWorkLinkRepository {
  linkWorkToConversation(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
    readonly conversationId: string;
  }): Promise<ConversationWorkLink>;

  findConversationIdByWork(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
  }): Promise<string | null>;

  findRecentWorkByConversation(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly conversationId: string;
    readonly limit?: number;
  }): Promise<readonly ConversationWorkLink[]>;
}

/** Server-derived origin carried by a trusted grant/context layer. */
export interface ConversationWorkOrigin {
  readonly conversationId: string;
  readonly triggerMessageId: string;
}
