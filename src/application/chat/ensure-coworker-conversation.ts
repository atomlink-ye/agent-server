import type { AgentDefinition } from '../../domain/agents/managed-agent-definition.js';
import type { Conversation } from '../../domain/chat/conversation.js';
import type { ConversationWorkEntitlement } from '../../domain/chat/conversation-work-entitlement.js';
import type { AccessContext } from '../../domain/access-context.js';
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
 * offered when the caller works in the AgentDefinition's own workspace, making
 * the definition's durable workspace unambiguous; Coworkers reached across a
 * workspace boundary keep the explicit work-context boundary.
 *
 * Sharing the workspace is an offer, not a grant: the entitlement repository
 * still refuses a caller who is not a member of it. That is why a person can
 * hold Work context at all -- a person never owns the workspace they work in,
 * a service account does, so gating on ownership would leave every human
 * without Work in chat.
 */
export class EnsureCoworkerConversation {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly workEntitlements?: ConversationWorkEntitlementRepository,
  ) {}

  public async execute(input: {
    readonly accessContext: AccessContext;
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

    const entitlement =
      this.workEntitlements && sharesDefinitionWorkspace(input)
        ? await this.workEntitlements.enable({
            tenantId: input.accessContext.tenantId,
            conversationId: conversation.id,
            workspaceId: input.definition.workspaceId,
            principalType: input.accessContext.principalType,
            principalId: input.accessContext.principalId,
          })
        : null;
    // An owner is a member of its own workspace by construction, so an owner
    // left without Work context means provisioning genuinely failed rather
    // than being declined.
    if (!entitlement && this.workEntitlements && isDefinitionOwner(input)) {
      throw new Error('Owner coworker Work context could not be provisioned.');
    }
    return { conversation, workEntitlement: entitlement };
  }
}

function sharesDefinitionWorkspace(input: {
  readonly accessContext: AccessContext;
  readonly definition: AgentDefinition;
}): boolean {
  return input.definition.workspaceId === input.accessContext.workspaceId;
}

function isDefinitionOwner(input: {
  readonly accessContext: AccessContext;
  readonly definition: AgentDefinition;
}): boolean {
  return (
    input.definition.principalType === input.accessContext.principalType &&
    input.definition.principalId === input.accessContext.principalId
  );
}
