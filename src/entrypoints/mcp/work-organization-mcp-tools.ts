import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import type { ConversationAgentIdentityResolver } from '../../application/work-organization/conversation-agent-identity.js';
import type { WorkOrganizationService } from '../../application/work-organization/work-organization-service.js';
import {
  WORK_ITEM_STATUSES,
  WorkItemClaimConflictError,
  WorkItemNotFoundError,
} from '../../domain/work-organization/work-organization.js';

export const WORK_ITEM_CLAIM_TOOL_REF = 'agent-server/work-item-claim';
export const WORK_ITEM_COMMENT_TOOL_REF = 'agent-server/work-item-comment';
export const WORK_ITEM_STATUS_TOOL_REF = 'agent-server/work-item-status';

const strictClaimInput = z.strictObject({
  work_item_id: z.string().uuid(),
});
type ClaimInput = z.infer<typeof strictClaimInput>;
const strictCommentInput = z.strictObject({
  work_item_id: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1)
    .max(16 * 1024),
});
type CommentInput = z.infer<typeof strictCommentInput>;
const strictStatusInput = z.strictObject({
  work_item_id: z.string().uuid(),
  status: z.enum(WORK_ITEM_STATUSES),
});
type StatusInput = z.infer<typeof strictStatusInput>;

export type { ConversationAgentIdentityResolver };

/**
 * Coworker-facing WorkItem coordination tools.
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
  readonly service: Pick<
    WorkOrganizationService,
    'claimWorkItem' | 'getWorkItemRecord' | 'addComment' | 'updateWorkItem'
  >;
  readonly agentIdentities: ConversationAgentIdentityResolver;
}): void {
  if (input.grant.catalogTools.includes(WORK_ITEM_CLAIM_TOOL_REF))
    registerClaimTool(input);
  if (input.grant.catalogTools.includes(WORK_ITEM_COMMENT_TOOL_REF))
    registerCommentTool(input);
  if (input.grant.catalogTools.includes(WORK_ITEM_STATUS_TOOL_REF))
    registerStatusTool(input);
}

function registerClaimTool(input: {
  readonly server: McpServer;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
  readonly service: Pick<WorkOrganizationService, 'claimWorkItem'>;
  readonly agentIdentities: ConversationAgentIdentityResolver;
}): void {
  (input.server.registerTool as any)(
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
      const current = await input.authorize(WORK_ITEM_CLAIM_TOOL_REF);
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
          accessContext: agentAccessContext(current),
          workItemId: args.work_item_id,
          claimantId: agentDefinitionId,
        });
        return success({
          claimed: true,
          work_item_id: claim.workItem.id,
          assignee_id: claim.workItem.assigneeId,
          moved_to_column_id: claim.movedToColumnId,
        });
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

function registerCommentTool(input: {
  readonly server: McpServer;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
  readonly service: Pick<
    WorkOrganizationService,
    'getWorkItemRecord' | 'addComment'
  >;
  readonly agentIdentities: ConversationAgentIdentityResolver;
}): void {
  (input.server.registerTool as any)(
    'work_item_comment',
    {
      description:
        '在你已被指派的 WorkItem 上添加一条评论。完成工作后先用此工具提交结果评论，再用 work_item_status 将状态设为 done。',
      inputSchema: strictCommentInput,
    },
    async (args: CommentInput) => {
      const current = await input.authorize(WORK_ITEM_COMMENT_TOOL_REF);
      if (!current) return toolError('not_found');
      const agentDefinitionId = await resolveAgentIdentity(
        current,
        input.agentIdentities,
      );
      if (!agentDefinitionId) return toolError('not_found');
      const accessContext = agentAccessContext(current, agentDefinitionId);

      try {
        const item = await input.service.getWorkItemRecord(
          accessContext,
          args.work_item_id,
        );
        if (item.assigneeId !== agentDefinitionId)
          return toolError('not_found');
        const comment = await input.service.addComment({
          accessContext,
          workItemId: args.work_item_id,
          body: args.body.trim(),
        });
        return success({
          comment_id: comment.id,
          work_item_id: comment.workItemId,
          author_id: comment.authorId,
        });
      } catch (error) {
        return toolError(
          error instanceof WorkItemNotFoundError
            ? 'not_found'
            : 'work_item_comment_failed',
        );
      }
    },
  );
}

function registerStatusTool(input: {
  readonly server: McpServer;
  readonly authorize: (
    toolRef: string,
  ) => Promise<AuthorizedRuntimeToolContext | null>;
  readonly service: Pick<
    WorkOrganizationService,
    'getWorkItemRecord' | 'updateWorkItem'
  >;
  readonly agentIdentities: ConversationAgentIdentityResolver;
}): void {
  (input.server.registerTool as any)(
    'work_item_status',
    {
      description:
        '更新你已被指派的 WorkItem 状态；完成工作时先添加结果评论，再将状态设为 done。',
      inputSchema: strictStatusInput,
    },
    async (args: StatusInput) => {
      const current = await input.authorize(WORK_ITEM_STATUS_TOOL_REF);
      if (!current) return toolError('not_found');
      const agentDefinitionId = await resolveAgentIdentity(
        current,
        input.agentIdentities,
      );
      if (!agentDefinitionId) return toolError('not_found');
      const accessContext = agentAccessContext(current, agentDefinitionId);

      try {
        const item = await input.service.getWorkItemRecord(
          accessContext,
          args.work_item_id,
        );
        if (item.assigneeId !== agentDefinitionId)
          return toolError('not_found');
        const updated = await input.service.updateWorkItem({
          accessContext,
          workItemId: args.work_item_id,
          status: args.status,
        });
        return success({
          work_item_id: updated.workItem.id,
          status: updated.workItem.status,
        });
      } catch (error) {
        return toolError(
          error instanceof WorkItemNotFoundError
            ? 'not_found'
            : 'work_item_status_failed',
        );
      }
    },
  );
}

async function resolveAgentIdentity(
  current: AuthorizedRuntimeToolContext,
  agentIdentities: ConversationAgentIdentityResolver,
): Promise<string | null> {
  if (!current.chatContext) return null;
  return agentIdentities.resolve({
    tenantId: current.tenantId,
    conversationId: current.chatContext.conversationId,
  });
}

function agentAccessContext(
  current: AuthorizedRuntimeToolContext,
  principalId = current.principalId,
) {
  return {
    tenantId: current.tenantId,
    workspaceId: current.workspaceId,
    principalType: 'service_account' as const,
    principalId,
    policySnapshotVersion: 'runtime-mcp',
  };
}

function success(value: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function toolError(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}
