import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WorkIdentityApi } from '../../application/work/work-identity-api.js';
import type { StartWorkRun } from '../../application/work/start-work-run.js';
import type {
  RuntimeToolGrant,
  RuntimeToolGrantService,
} from '../../application/extensions/runtime-tool-grant-service.js';
import {
  toExecutionReceiptResponse,
  toWorkResponse,
  toWorkRunResponse,
} from '../../contracts/product-work-commands.js';

export const PRODUCT_WORK_CREATE_TOOL_REF = 'agent-server/product-work-create';
export const PRODUCT_WORK_RUN_START_TOOL_REF = 'agent-server/product-work-run-start';

const createInput = {
  definition_id: z.string().uuid(),
  definition_version_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
};
const startInput = {
  work_id: z.string().uuid(),
  trigger_kind: z.literal('manual'),
  trigger_ref: z.string().min(1).max(256).optional(),
};
const strictCreateInput = z.strictObject(createInput);
const strictStartInput = z.strictObject(startInput);

export function registerProductWorkMcpTools(input: {
  readonly server: McpServer;
  readonly grant: RuntimeToolGrant;
  readonly grants: RuntimeToolGrantService;
  readonly workIdentity: Pick<WorkIdentityApi, 'createWork'>;
  readonly startWorkRun: Pick<StartWorkRun, 'execute'>;
}): void {
  const { server, grant, grants } = input;
  if (grant.catalogTools.includes(PRODUCT_WORK_CREATE_TOOL_REF))
    (server.registerTool as any)(
      'product_work_create',
      {
        description: 'Create a durable product Work.',
        inputSchema: strictCreateInput,
      },
      async (args) => {
        const current = grants.get(grant.grantId);
        if (!current || !grants.isToolAllowed(current.grantId, PRODUCT_WORK_CREATE_TOOL_REF))
          return { isError: true, content: [{ type: 'text', text: 'not_found' }] };
        grants.beginToolCall(current.grantId);
        try {
          const work = await input.workIdentity.createWork({
            owner: { tenantId: current.tenantId, workspaceId: current.workspaceId },
            accessContext: {
              tenantId: current.tenantId,
              workspaceId: current.workspaceId,
              principalType: 'service_account',
              principalId: current.principalId,
              policySnapshotVersion: 'runtime-mcp',
            },
            definitionId: args.definition_id,
            definitionVersionId: args.definition_version_id,
            title: args.title,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ work: toWorkResponse(work) }) }] };
        } finally {
          grants.endToolCall(current.grantId);
        }
      },
    );
  if (grant.catalogTools.includes(PRODUCT_WORK_RUN_START_TOOL_REF))
    (server.registerTool as any)(
      'product_work_run_start',
      {
        description: 'Start a durable product WorkRun.',
        inputSchema: strictStartInput,
      },
      async (args) => {
        const current = grants.get(grant.grantId);
        if (!current || !grants.isToolAllowed(current.grantId, PRODUCT_WORK_RUN_START_TOOL_REF))
          return { isError: true, content: [{ type: 'text', text: 'not_found' }] };
        grants.beginToolCall(current.grantId);
        try {
          const result = await input.startWorkRun.execute({
            accessContext: {
              tenantId: current.tenantId,
              workspaceId: current.workspaceId,
              principalType: 'service_account',
              principalId: current.principalId,
              policySnapshotVersion: 'runtime-mcp',
            },
            workId: args.work_id,
            triggerKind: args.trigger_kind,
            ...(args.trigger_ref !== undefined ? { triggerRef: args.trigger_ref } : {}),
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                work_run: toWorkRunResponse(result.workRun),
                execution_receipt: toExecutionReceiptResponse(result.executionReceipt),
              }),
            }],
          };
        } finally {
          grants.endToolCall(current.grantId);
        }
      },
    );
}
