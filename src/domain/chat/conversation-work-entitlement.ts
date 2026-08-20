export interface ConversationWorkEntitlement {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly principalType: 'service_account';
  readonly principalId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
