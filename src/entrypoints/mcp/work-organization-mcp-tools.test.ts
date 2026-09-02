import { describe, expect, it } from 'vitest';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import { WorkItemClaimConflictError } from '../../domain/work-organization/work-organization.js';
import {
  registerWorkOrganizationMcpTools,
  WORK_ITEM_CLAIM_TOOL_REF,
} from './work-organization-mcp-tools.js';

const workItemId = '00000000-0000-4000-8000-000000000050';
const agentDefinitionId = '00000000-0000-4000-8000-000000000041';

type Handler = (args: {
  work_item_id: string;
}) => Promise<{ isError?: boolean; content: { text: string }[] }>;

function grant(
  overrides?: Record<string, unknown>,
): AuthorizedRuntimeToolContext {
  return {
    grantId: 'grant-1',
    tenantId: 'tenant-test',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    principalType: 'service_account',
    principalId: 'runtime-principal',
    scopeId: 'chat-runtime-1',
    allowedTools: [WORK_ITEM_CLAIM_TOOL_REF],
    catalogTools: [WORK_ITEM_CLAIM_TOOL_REF],
    runtimeSession: 'session-1',
    generation: 1,
    chatContext: {
      conversationId: '00000000-0000-4000-8000-000000000010',
      triggerMessageId: '00000000-0000-4000-8000-000000000011',
    },
    ...overrides,
  } as unknown as AuthorizedRuntimeToolContext;
}

function register(input: {
  readonly current: AuthorizedRuntimeToolContext | null;
  readonly identity: string | null;
  readonly claim?: () => Promise<unknown>;
}): { handler: Handler | null; claimed: string[] } {
  let handler: Handler | null = null;
  const claimed: string[] = [];
  const server = {
    registerTool(_name: string, _config: unknown, callback: Handler) {
      handler = callback;
    },
  };
  registerWorkOrganizationMcpTools({
    server: server as never,
    grant: grant(),
    async authorize() {
      return input.current;
    },
    service: {
      async claimWorkItem(request: { workItemId: string }) {
        claimed.push(request.workItemId);
        if (input.claim) return (await input.claim()) as never;
        return {
          workItem: { id: request.workItemId, assigneeId: agentDefinitionId },
          movedToColumnId: null,
        } as never;
      },
    } as never,
    agentIdentities: {
      async resolve() {
        return input.identity;
      },
    },
  });
  return { handler, claimed };
}

describe('work_item_claim MCP tool', () => {
  it('claims as the Coworker resolved from the conversation', async () => {
    const { handler, claimed } = register({
      current: grant(),
      identity: agentDefinitionId,
    });
    const result = await handler!({ work_item_id: workItemId });
    expect(claimed).toEqual([workItemId]);
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      claimed: true,
      work_item_id: workItemId,
      assignee_id: agentDefinitionId,
      moved_to_column_id: null,
    });
  });

  it('refuses rather than claiming under the platform principal', async () => {
    // No chat context, so there is no Coworker identity to claim AS.
    const withoutChat = register({
      current: grant({ chatContext: undefined }),
      identity: agentDefinitionId,
    });
    const noChat = await withoutChat.handler!({ work_item_id: workItemId });
    expect(noChat.isError).toBe(true);
    expect(withoutChat.claimed).toEqual([]);

    // Ambiguous or missing membership is the same refusal.
    const withoutIdentity = register({ current: grant(), identity: null });
    const noIdentity = await withoutIdentity.handler!({
      work_item_id: workItemId,
    });
    expect(noIdentity.isError).toBe(true);
    expect(withoutIdentity.claimed).toEqual([]);
  });

  it('reports a lost race as structured data the agent can act on', async () => {
    const { handler } = register({
      current: grant(),
      identity: agentDefinitionId,
      claim: async () => {
        throw new WorkItemClaimConflictError('agent-someone-else');
      },
    });
    const result = await handler!({ work_item_id: workItemId });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      claimed: false,
      reason: 'work_item_claim_conflict',
      holder_id: 'agent-someone-else',
    });
  });

  it('registers nothing when the grant does not carry the tool', async () => {
    let registered = false;
    registerWorkOrganizationMcpTools({
      server: {
        registerTool() {
          registered = true;
        },
      } as never,
      grant: grant({ catalogTools: [] }),
      async authorize() {
        return null;
      },
      service: { async claimWorkItem() {} } as never,
      agentIdentities: {
        async resolve() {
          return null;
        },
      },
    });
    expect(registered).toBe(false);
  });
});
