import type { ConversationWorkEntitlement } from '../../domain/chat/conversation-work-entitlement.js';

export interface ConversationWorkEntitlementRepository {
  enable(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<ConversationWorkEntitlement | null>;

  revoke(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalType: string;
    readonly principalId: string;
  }): Promise<boolean>;

  /** Trusted server-side resolution for one chat turn. */
  resolveForChatTurn(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly agentDefinitionId: string;
  }): Promise<ConversationWorkEntitlement | null>;
}
