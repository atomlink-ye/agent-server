import { SERVICE_ACCOUNT_PRINCIPAL_TYPE } from '../../platform/access-context.js';

export interface ConversationWorkEntitlement {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly principalType: typeof SERVICE_ACCOUNT_PRINCIPAL_TYPE;
  readonly principalId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function assertServiceAccountWorkEntitlement(
  entitlement: Pick<ConversationWorkEntitlement, 'principalType'>,
): void {
  if (entitlement.principalType !== SERVICE_ACCOUNT_PRINCIPAL_TYPE)
    throw new Error('Conversation Work entitlements require a service account.');
}
