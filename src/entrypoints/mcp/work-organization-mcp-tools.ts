import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import type { ConversationAgentIdentityResolver } from '../../application/work-organization/conversation-agent-identity.js';
import type { WorkOrganizationService } from '../../application/work-organization/work-organization-service.js';
import { WorkItemClaimConflictError } from '../../domain/work-organization/work-organization.js';

export const WORK_ITEM_CLAIM_TOOL_REF = 'agent-server/work-item-claim';

const strictClaimInput = z.strictObject({
  work_item_id: z.string().uuid(),
});
type ClaimInput = z.infer<typeof strictClaimInput>;

export type { ConversationAgentIdentityResolver };

/**
 * The Coworker-facing claim tool.
 *
 * This is the product coordination plane (product_work_items), NOT the
 * Team-collaboration `board_*` protocol in src/domain/collaboration. The two are
 * unrelated: that one coordinates members inside a single TeamRun, this one is
 * the WorkItem board a human shares with their Coworkers.
 */
export function registerWorkOrganizationMcpTools(input: {
  readonly server: McpServer;
  readonly grant: AuthorizedRuntimeToolContext;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
  readonly service: Pick<WorkOrganizationService, 'claimWorkItem'>;
  readonly agentIdentities: ConversationAgentIdentityResolver;
}): void {
  const { server, grant, authorize } = input;
  if (!grant.catalogTools.includes(WORK_ITEM_CLAIM_TOOL_REF)) return;

  (server.registerTool as any)(
    'work_item_claim',
    {
      // Agent-facing prose: the model reads this to decide whether to call.
      description:
        '认领一个 WorkItem，表示由你来做这项工作。认领是原子的：同一个 WorkItem 只会有一个认领者成功，' +
        '失败说明已有人在做，此时不要开始工作。如果该 WorkItem 在看板上，且看板声明了 Doing 列，' +
        '认领成功会同时把它移动到 Doing 列。开始动手之前先认领。',
      inputSchema: strictClaimInput,
    },
    async (args: ClaimInput) => {
      const current = await authorize(WORK_ITEM_CLAIM_TOOL_REF);
      if (!current) return toolError('not_found');

      // Without a conversation there is no agent identity to claim AS, and
      // claiming under the runtime's principal would attribute the work to the
      // platform rather than to the Coworker. Failing honestly beats a wrong
      // assignee_id that a human then has to untangle.
      if (!current.chatContext)
        return toolError(
          '认领需要在对话上下文中进行，当前调用没有对话上下文。',
        );
      const agentDefinitionId = await input.agentIdentities.resolve({
        tenantId: current.tenantId,
        conversationId: current.chatContext.conversationId,
      });
      if (!agentDefinitionId)
        return toolError(
          '无法确定你的 Coworker 身份，因此不能认领这个 WorkItem。',
        );

      try {
        const claim = await input.service.claimWorkItem({
          accessContext: {
            tenantId: current.tenantId,
            workspaceId: current.workspaceId,
            principalType: 'service_account',
            principalId: current.principalId,
            policySnapshotVersion: 'runtime-mcp',
          },
          workItemId: args.work_item_id,
          claimantId: agentDefinitionId,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                claimed: true,
                work_item_id: claim.workItem.id,
                assignee_id: claim.workItem.assigneeId,
                moved_to_column_id: claim.movedToColumnId,
              }),
            },
          ],
        };
      } catch (error) {
        // A lost race is an ordinary outcome, not a fault, so it comes back as
        // a structured result the agent can act on rather than a raw throw.
        if (error instanceof WorkItemClaimConflictError)
          return toolError(
            JSON.stringify({
              claimed: false,
              reason: error.code,
              holder_id: error.holderId,
              message: error.message,
            }),
          );
        throw error;
      }
    },
  );
}

function toolError(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}
