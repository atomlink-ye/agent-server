import type { AgentChatRuntime } from '../../domain/chat/agent-chat-runtime.js';
import type {
  PrincipalRef,
  ProductScope,
  ResourceOwner,
} from '../../domain/tenancy/product-context.js';
import type { RuntimeInvocationContext } from '../../domain/runtime/runtime-invocation-context.js';

export interface ConversationActorResolver {
  resolve(input: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly principalId: string;
  }): Promise<PrincipalRef | null>;
}

export type ChatTurnContext = Readonly<{
  readonly productScope: ProductScope;
  readonly actor: PrincipalRef;
  readonly agentOwner: ResourceOwner;
  readonly conversationId: string;
  readonly triggerMessageId: string;
  readonly agentDefinitionId: string;
  readonly agentVersionId: string;
  readonly agentChatRuntimeId: string;
  readonly runtimeEpoch: number;
  readonly workEntitlementWorkspaceId?: string;
}>;

export function createChatTurnContext(input: {
  readonly productScope: ProductScope;
  readonly actor: PrincipalRef;
  readonly agentOwner: ResourceOwner;
  readonly conversationId: string;
  readonly triggerMessageId: string;
  readonly agentDefinitionId: string;
  readonly runtime: AgentChatRuntime;
  readonly workEntitlementWorkspaceId?: string;
}): ChatTurnContext {
  if (input.runtime.agentDefinitionId !== input.agentDefinitionId)
    throw new Error(
      'Chat runtime AgentDefinition does not match turn context.',
    );
  if (input.runtime.tenantId !== input.productScope.tenantId)
    throw new Error('Chat runtime tenant does not match turn context.');
  return Object.freeze({
    productScope: input.productScope,
    actor: input.actor,
    agentOwner: input.agentOwner,
    conversationId: input.conversationId,
    triggerMessageId: input.triggerMessageId,
    agentDefinitionId: input.agentDefinitionId,
    agentVersionId: input.runtime.activeAgentVersionId,
    agentChatRuntimeId: input.runtime.id,
    runtimeEpoch: input.runtime.epoch,
    ...(input.workEntitlementWorkspaceId
      ? { workEntitlementWorkspaceId: input.workEntitlementWorkspaceId }
      : {}),
  });
}

export function runtimeInvocationContextForChat(
  turn: ChatTurnContext,
): RuntimeInvocationContext {
  return Object.freeze({
    scope: {
      kind: 'agent_chat' as const,
      agentChatRuntimeId: turn.agentChatRuntimeId,
      runtimeEpoch: turn.runtimeEpoch,
    },
    productScope: turn.productScope,
    actor: turn.actor,
    agentOwner: turn.agentOwner,
    agentDefinitionId: turn.agentDefinitionId,
    agentVersionId: turn.agentVersionId,
    conversationId: turn.conversationId,
    triggerMessageId: turn.triggerMessageId,
  });
}
