import type { ExecutionExtensionBinding } from '../ports/execution-plane.js';
import type { RuntimeExtensionBinder } from '../extensions/runtime-extension-binder.js';
import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../agents/built-in-skills.js';
import type { ResolvedChatBrain } from './chat-brain-resolver.js';
import type { ResolvedChatTurnContext } from './resolve-chat-turn-context.js';

/** Binds only capabilities admitted for this durable Chat activation. */
export class BindChatCapabilities {
  public constructor(private readonly binder?: RuntimeExtensionBinder) {}

  public async execute(
    context: ResolvedChatTurnContext,
    brain: ResolvedChatBrain,
  ): Promise<ExecutionExtensionBinding | undefined> {
    const entitlement = context.workEntitlement;
    if (!entitlement || !this.binder) return undefined;

    const workTools = [
      AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
      AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
    ] as const;
    const requestedToolRefs = new Set(brain.toolRefs);
    for (const tool of workTools) requestedToolRefs.add(tool);

    return this.binder.bind({
      tenantId: entitlement.tenantId,
      principalType: entitlement.principalType,
      principalId: entitlement.principalId,
      workspaceId: entitlement.workspaceId,
      scopeId: context.runtime.id,
      chatContext: {
        conversationId: context.dispatch.conversationId,
        triggerMessageId: context.triggerMessage.id,
      },
      // The persisted Chat brain stores the launch-snapshot skill identity;
      // full runtime skill packages remain owned by the runtime module.
      skills: [],
      toolRefs: [...requestedToolRefs],
      catalogTools: [...requestedToolRefs],
    });
  }
}
