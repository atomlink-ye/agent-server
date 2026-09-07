import type {
  SERVICE_ACCOUNT_PRINCIPAL_TYPE,
  USER_PRINCIPAL_TYPE,
} from '../access-context.js';

/**
 * Work context attached to one direct Conversation. The entitled principal is
 * whoever the Conversation belongs to -- a person as readily as a service
 * account -- because Work follows the workspace they both work in.
 */
export interface ConversationWorkEntitlement {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly principalType:
    typeof SERVICE_ACCOUNT_PRINCIPAL_TYPE | typeof USER_PRINCIPAL_TYPE;
  readonly principalId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
