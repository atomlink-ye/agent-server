import type {
  ResolvedChatBrain,
  ChatBrainResolver,
} from './chat-brain-resolver.js';
import type { ResolvedChatTurnContext } from './resolve-chat-turn-context.js';

/** Focused Agent-definition/context projection seam for one resolved activation. */
export class ResolveChatBrain {
  public constructor(
    private readonly resolver: Pick<ChatBrainResolver, 'resolve'>,
  ) {}

  public execute(context: ResolvedChatTurnContext): Promise<ResolvedChatBrain> {
    return this.resolver.resolve({
      tenantId: context.dispatch.tenantId,
      agentDefinitionId: context.dispatch.agentDefinitionId,
      conversationId: context.dispatch.conversationId,
      triggerMessageId: context.triggerMessage.id,
      runtime: context.runtime,
      ...(context.actor ? { actor: context.actor } : {}),
      ...(context.workEntitlement
        ? { workEntitlementWorkspaceId: context.workEntitlement.workspaceId }
        : {}),
    });
  }
}
