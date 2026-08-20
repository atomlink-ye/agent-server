/**
 * Durable relationship between a Product Work and its originating
 * conversation. The relationship is scoped by the authenticated tenant and
 * workspace; a reply's chat_messages.work_ref is derived from its trigger
 * message origin when exactly one Work was declared.
 */
export interface ConversationWorkLink {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
  readonly conversationId: string;
  readonly triggerMessageId: string | null;
  readonly createdAt: string;
}

export interface ConversationWorkLinkRepository {
  linkWorkToConversation(input: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly workId: string;
    readonly conversationId: string;
    /** Trusted chat turn origin; historical rows remain nullable in storage. */
    readonly triggerMessageId: string;
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

  findWorkIdsByOrigin(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly triggerMessageId: string;
  }): Promise<readonly string[]>;
}

/** Server-derived origin carried by a trusted grant/context layer. */
export interface ConversationWorkOrigin {
  readonly conversationId: string;
  readonly triggerMessageId: string;
}
