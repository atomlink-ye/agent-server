import type { AgentDefinition } from '../../domain/agents/managed-agent-definition.js';
import type { Conversation } from '../../domain/chat/conversation.js';
import type { ConversationWorkEntitlement } from '../../domain/chat/conversation-work-entitlement.js';
import type { ServiceAccountAccessContext } from '../../domain/access-context.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import type { ConversationWorkEntitlementRepository } from '../ports/conversation-work-entitlement-repository.js';

export interface CoworkerConversationProvisioningResult {
  readonly conversation: Conversation;
  readonly workEntitlement: ConversationWorkEntitlement | null;
}

/**
 * Converges one human/service-account ↔ AgentDefinition relationship.
 *
 * Direct Conversation is always idempotently created. Work context is only
 * auto-provisioned when the caller is the AgentDefinition owner, making the
 * definition's durable workspace unambiguous. Shared/cross-owner coworkers
 * intentionally keep the explicit work-context boundary.
 */
export class EnsureCoworkerConversation {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly workEntitlements?: ConversationWorkEntitlementRepository,
  ) {}

  public async execute(input: {
    readonly accessContext: ServiceAccountAccessContext;
    readonly definition: AgentDefinition;
  }): Promise<CoworkerConversationProvisioningResult> {
    if (input.definition.tenantId !== input.accessContext.tenantId) {
      throw new Error(
        'Coworker definition is outside the authenticated tenant.',
      );
    }

    const conversation = await this.conversations.findOrCreateDirect({
      tenantId: input.accessContext.tenantId,
      principalId: input.accessContext.principalId,
      principalType: input.accessContext.principalType,
      agentDefinitionId: input.definition.id,
    });

    if (!this.workEntitlements || !isSameOwner(input)) {
      return { conversation, workEntitlement: null };
    }

    const entitlement = await this.workEntitlements.enable({
      tenantId: input.accessContext.tenantId,
      conversationId: conversation.id,
      workspaceId: input.definition.workspaceId,
      principalType: input.accessContext.principalType,
      principalId: input.accessContext.principalId,
    });
    if (!entitlement) {
      throw new Error(
        'Same-owner coworker Work context could not be provisioned.',
      );
    }
    return { conversation, workEntitlement: entitlement };
  }
}

function isSameOwner(input: {
  readonly accessContext: ServiceAccountAccessContext;
  readonly definition: AgentDefinition;
}): boolean {
  return (
    input.definition.principalType === input.accessContext.principalType &&
    input.definition.principalId === input.accessContext.principalId
  );
}
