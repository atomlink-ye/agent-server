export type ConversationKind = 'direct' | 'group';

export interface DirectAgentIdentity {
  readonly agentDefinitionId: string;
  readonly displayName: string | null;
}

export interface Conversation {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: ConversationKind;
  readonly title: string | null;
  readonly directAgent: DirectAgentIdentity | null;
  readonly topic: string | null;
  readonly directPairKey: string | null;
  readonly nextSequence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ConversationMemberType = 'principal' | 'agent_definition';

export interface ConversationMember {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly memberType: ConversationMemberType;
  readonly memberId: string;
  readonly memberPrincipalType: string | null;
  readonly role: string | null;
  readonly joinedAt: string;
}

/**
 * Produces a deterministic, role-tagged canonical key for direct conversations.
 * Principal always occupies the first position, agent_definition the second,
 * to ensure uniqueness without requiring order-independence in the input.
 */
export function directPairKey(
  tenantId: string,
  principalId: string,
  agentDefinitionId: string,
): string {
  return `direct:${tenantId}:${principalId}:${agentDefinitionId}`;
}

export function assertDirectConversationInvariant(
  members: readonly ConversationMember[],
): void {
  const principals = members.filter((m) => m.memberType === 'principal');
  const agents = members.filter((m) => m.memberType === 'agent_definition');
  if (principals.length !== 1 || agents.length !== 1) {
    throw new Error(
      'Direct conversation must have exactly 1 principal member and 1 agent_definition member.',
    );
  }
}
