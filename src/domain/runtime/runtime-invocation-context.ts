import type { PrincipalRef, ProductScope, ResourceOwner } from '../tenancy/product-context.js';

export type RuntimeScope =
  | Readonly<{ kind: 'agent_chat'; agentChatRuntimeId: string }>
  | Readonly<{ kind: 'task'; taskId: string }>
  | Readonly<{ kind: 'team_member'; teamMemberRunId: string }>
  | Readonly<{ kind: 'product_session'; productSessionId: string }>;

export type RuntimeInvocationContext = Readonly<{
  scope: RuntimeScope;
  productScope: ProductScope;
  actor: PrincipalRef;
  agentOwner: ResourceOwner;
  agentDefinitionId: string;
  agentVersionId: string;
  conversationId?: string;
  triggerMessageId?: string;
  workId?: string;
  workRunId?: string;
}>;
