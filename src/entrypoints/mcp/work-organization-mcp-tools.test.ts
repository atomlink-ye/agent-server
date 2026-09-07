import { describe, expect, it } from 'vitest';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import { WorkOrganizationService } from '../../application/work-organization/work-organization-service.js';
import { WorkItemClaimConflictError } from '../../domain/work-organization/work-organization.js';
import {
  registerWorkOrganizationMcpTools,
  WORK_ITEM_CLAIM_TOOL_REF,
  WORK_ITEM_COMMENT_TOOL_REF,
  WORK_ITEM_STATUS_TOOL_REF,
} from './work-organization-mcp-tools.js';

const workItemId = '00000000-0000-4000-8000-000000000050';
const agentDefinitionId = '00000000-0000-4000-8000-000000000041';

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: { text: string }[];
}>;

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
    allowedTools: [
      WORK_ITEM_CLAIM_TOOL_REF,
      WORK_ITEM_COMMENT_TOOL_REF,
      WORK_ITEM_STATUS_TOOL_REF,
    ],
    catalogTools: [
      WORK_ITEM_CLAIM_TOOL_REF,
      WORK_ITEM_COMMENT_TOOL_REF,
      WORK_ITEM_STATUS_TOOL_REF,
    ],
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
  readonly catalogTools?: readonly string[];
  readonly workItemAssigneeId?: string | null;
  readonly updatedStatus?: 'todo' | 'in_progress' | 'in_review' | 'done';
  readonly commentError?: unknown;
  readonly statusError?: unknown;
  readonly service?: Record<string, unknown>;
}): {
  handlers: Map<string, Handler>;
  claimed: string[];
  comments: Array<Record<string, unknown>>;
  statuses: Array<Record<string, unknown>>;
  getItems: string[];
  configs: Map<string, Record<string, unknown>>;
  authorized: string[];
} {
  const handlers = new Map<string, Handler>();
  const configs = new Map<string, Record<string, unknown>>();
  const claimed: string[] = [];
  const comments: Array<Record<string, unknown>> = [];
  const statuses: Array<Record<string, unknown>> = [];
  const getItems: string[] = [];
  const authorized: string[] = [];
  const server = {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      callback: Handler,
    ) {
      handlers.set(name, callback);
      configs.set(name, config);
    },
  };
  const grantOverrides = input.catalogTools
    ? { catalogTools: input.catalogTools }
    : undefined;
  const service = input.service ?? {
    async claimWorkItem(request: { workItemId: string }) {
      claimed.push(request.workItemId);
      if (input.claim) return (await input.claim()) as never;
      return {
        workItem: { id: request.workItemId, assigneeId: agentDefinitionId },
        movedToColumnId: null,
      } as never;
    },
    async getWorkItemRecord(_accessContext: unknown, workItemId: string) {
      getItems.push(workItemId);
      return {
        id: workItemId,
        assigneeId:
          input.workItemAssigneeId === undefined
            ? agentDefinitionId
            : input.workItemAssigneeId,
      } as never;
    },
    async addComment(request: Record<string, unknown>) {
      if (input.commentError) throw input.commentError;
      comments.push(request);
      return {
        id: '00000000-0000-4000-8000-000000000060',
        workItemId: request.workItemId,
        authorId: (request.accessContext as { principalId: string })
          .principalId,
        body: request.body,
      } as never;
    },
    async updateWorkItem(request: Record<string, unknown>) {
      if (input.statusError) throw input.statusError;
      statuses.push(request);
      return {
        workItem: {
          id: request.workItemId,
          assigneeId: agentDefinitionId,
          status: input.updatedStatus ?? request.status,
        },
        linkedWork: null,
      } as never;
    },
  };
  registerWorkOrganizationMcpTools({
    server: server as never,
    grant: grant(grantOverrides),
    async authorize(toolRef) {
      authorized.push(toolRef);
      return input.current;
    },
    service: service as never,
    agentIdentities: {
      async resolve() {
        return input.identity;
      },
    },
  });
  return {
    handlers,
    claimed,
    comments,
    statuses,
    getItems,
    configs,
    authorized,
  };
}

describe('work_item_claim MCP tool', () => {
  it('claims as the Coworker resolved from the conversation', async () => {
    const { handlers, claimed } = register({
      current: grant(),
      identity: agentDefinitionId,
    });
    const result = await handlers.get('work_item_claim')!({
      work_item_id: workItemId,
    });
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
    const noChat = await withoutChat.handlers.get('work_item_claim')!({
      work_item_id: workItemId,
    });
    expect(noChat.isError).toBe(true);
    expect(withoutChat.claimed).toEqual([]);

    // Ambiguous or missing membership is the same refusal.
    const withoutIdentity = register({ current: grant(), identity: null });
    const noIdentity = await withoutIdentity.handlers.get('work_item_claim')!({
      work_item_id: workItemId,
    });
    expect(noIdentity.isError).toBe(true);
    expect(withoutIdentity.claimed).toEqual([]);
  });

  it('reports a lost race as structured data the agent can act on', async () => {
    const { handlers } = register({
      current: grant(),
      identity: agentDefinitionId,
      claim: async () => {
        throw new WorkItemClaimConflictError('agent-someone-else');
      },
    });
    const result = await handlers.get('work_item_claim')!({
      work_item_id: workItemId,
    });
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

describe('work_item_comment MCP tool', () => {
  it('adds a trimmed comment as the resolved Coworker', async () => {
    const setup = register({
      current: grant(),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_COMMENT_TOOL_REF],
    });
    const result = await setup.handlers.get('work_item_comment')!({
      work_item_id: workItemId,
      body: '  Finished the requested work.  ',
    });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      comment_id: '00000000-0000-4000-8000-000000000060',
      work_item_id: workItemId,
      author_id: agentDefinitionId,
    });
    expect(setup.getItems).toEqual([workItemId]);
    expect(setup.comments[0]).toMatchObject({
      workItemId,
      body: 'Finished the requested work.',
      accessContext: {
        tenantId: 'tenant-test',
        workspaceId: '00000000-0000-4000-8000-000000000001',
        principalId: agentDefinitionId,
      },
    });
    expect(setup.authorized).toEqual([WORK_ITEM_COMMENT_TOOL_REF]);
  });

  it('rejects an unassigned or foreign WorkItem without mutation', async () => {
    for (const workItemAssigneeId of [null, 'agent-other']) {
      const setup = register({
        current: grant(),
        identity: agentDefinitionId,
        catalogTools: [WORK_ITEM_COMMENT_TOOL_REF],
        workItemAssigneeId,
      });
      const result = await setup.handlers.get('work_item_comment')!({
        work_item_id: workItemId,
        body: 'Should not land.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toBe('not_found');
      expect(setup.comments).toEqual([]);
    }
  });

  it('checks assignment from a raw service read before linked-work hydration', async () => {
    let projectionLookups = 0;
    let updates = 0;
    let comments = 0;
    const repository = {
      async findWorkItemById() {
        return {
          id: workItemId,
          assigneeId: 'agent-other',
          linkedWorkId: '00000000-0000-4000-8000-000000000061',
        } as never;
      },
      async updateWorkItem() {
        updates += 1;
        return null;
      },
      async createComment() {
        comments += 1;
        return null;
      },
    };
    const service = new WorkOrganizationService({
      repository: repository as never,
      workIdentity: {
        async createWork() {
          throw new Error('not expected');
        },
        async findWorkById() {
          projectionLookups += 1;
          throw new Error('linked projection must not be read');
        },
      } as never,
      workListProjection: async () => {
        throw new Error('linked projection must not be hydrated');
      },
    });
    const setup = register({
      current: grant(),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_COMMENT_TOOL_REF],
      service: service as unknown as Record<string, unknown>,
    });

    const result = await setup.handlers.get('work_item_comment')!({
      work_item_id: workItemId,
      body: 'Should not land.',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('not_found');
    expect(projectionLookups).toBe(0);
    expect(updates).toBe(0);
    expect(comments).toBe(0);
  });

  it('refuses without a current chat identity or when the grant is revoked', async () => {
    const noChat = register({
      current: grant({ chatContext: undefined }),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_COMMENT_TOOL_REF],
    });
    const noChatResult = await noChat.handlers.get('work_item_comment')!({
      work_item_id: workItemId,
      body: 'Should not land.',
    });
    expect(noChatResult.isError).toBe(true);
    expect(noChat.comments).toEqual([]);

    const noIdentity = register({
      current: grant(),
      identity: null,
      catalogTools: [WORK_ITEM_COMMENT_TOOL_REF],
    });
    const noIdentityResult = await noIdentity.handlers.get(
      'work_item_comment',
    )!({
      work_item_id: workItemId,
      body: 'Should not land.',
    });
    expect(noIdentityResult.isError).toBe(true);
    expect(noIdentity.comments).toEqual([]);

    const revoked = register({
      current: null,
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_COMMENT_TOOL_REF],
    });
    const revokedResult = await revoked.handlers.get('work_item_comment')!({
      work_item_id: workItemId,
      body: 'Should not land.',
    });
    expect(revokedResult.isError).toBe(true);
    expect(revoked.getItems).toEqual([]);
  });

  it('sanitizes unexpected service failures', async () => {
    const setup = register({
      current: grant(),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_COMMENT_TOOL_REF],
      commentError: new Error('private database details'),
    });
    const result = await setup.handlers.get('work_item_comment')!({
      work_item_id: workItemId,
      body: 'Will fail.',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('work_item_comment_failed');
    expect(result.content[0]!.text).not.toContain('private');
  });
});

describe('work_item_status MCP tool', () => {
  it('updates status as the resolved Coworker with preserved scope', async () => {
    const setup = register({
      current: grant(),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_STATUS_TOOL_REF],
      updatedStatus: 'done',
    });
    const result = await setup.handlers.get('work_item_status')!({
      work_item_id: workItemId,
      status: 'done',
    });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      work_item_id: workItemId,
      status: 'done',
    });
    expect(setup.getItems).toEqual([workItemId]);
    expect(setup.statuses[0]).toMatchObject({
      workItemId,
      status: 'done',
      accessContext: {
        tenantId: 'tenant-test',
        workspaceId: '00000000-0000-4000-8000-000000000001',
        principalId: agentDefinitionId,
      },
    });
    expect(setup.authorized).toEqual([WORK_ITEM_STATUS_TOOL_REF]);
  });

  it('rejects an unassigned or foreign WorkItem without mutation', async () => {
    for (const workItemAssigneeId of [null, 'agent-other']) {
      const setup = register({
        current: grant(),
        identity: agentDefinitionId,
        catalogTools: [WORK_ITEM_STATUS_TOOL_REF],
        workItemAssigneeId,
      });
      const result = await setup.handlers.get('work_item_status')!({
        work_item_id: workItemId,
        status: 'done',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toBe('not_found');
      expect(setup.statuses).toEqual([]);
    }
  });

  it('sanitizes unexpected service failures', async () => {
    const setup = register({
      current: grant(),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_STATUS_TOOL_REF],
      statusError: new Error('private database details'),
    });
    const result = await setup.handlers.get('work_item_status')!({
      work_item_id: workItemId,
      status: 'done',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('work_item_status_failed');
    expect(result.content[0]!.text).not.toContain('private');
  });
});

describe('work-item MCP registration', () => {
  it('registers each tool independently from catalog grants', () => {
    const commentOnly = register({
      current: grant(),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_COMMENT_TOOL_REF],
    });
    expect([...commentOnly.handlers.keys()]).toEqual(['work_item_comment']);

    const statusOnly = register({
      current: grant(),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_STATUS_TOOL_REF],
    });
    expect([...statusOnly.handlers.keys()]).toEqual(['work_item_status']);
  });

  it('uses strict bounded schemas for comment and status', () => {
    const setup = register({
      current: grant(),
      identity: agentDefinitionId,
      catalogTools: [WORK_ITEM_COMMENT_TOOL_REF, WORK_ITEM_STATUS_TOOL_REF],
    });
    const commentSchema = setup.configs.get('work_item_comment')!
      .inputSchema as {
      safeParse(value: unknown): { success: boolean; data?: unknown };
    };
    const statusSchema = setup.configs.get('work_item_status')!.inputSchema as {
      safeParse(value: unknown): { success: boolean; data?: unknown };
    };

    const parsedComment = commentSchema.safeParse({
      work_item_id: workItemId,
      body: '  bounded body  ',
    });
    expect(parsedComment.success).toBe(true);
    expect((parsedComment.data as { body: string }).body).toBe('bounded body');
    expect(
      commentSchema.safeParse({
        work_item_id: workItemId,
        body: 'x'.repeat(16 * 1024 + 1),
      }).success,
    ).toBe(false);
    expect(
      commentSchema.safeParse({
        work_item_id: workItemId,
        body: 'body',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      statusSchema.safeParse({
        work_item_id: workItemId,
        status: 'not-a-status',
      }).success,
    ).toBe(false);
  });
});
