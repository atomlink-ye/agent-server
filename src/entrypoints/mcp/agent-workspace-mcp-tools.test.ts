import { describe, expect, it } from 'vitest';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import {
  AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
  AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
  AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
} from '../../application/agents/built-in-skills.js';
import { registerAgentWorkspaceMcpTools } from './agent-workspace-mcp-tools.js';
import { InvalidAgentHomePathError } from '../../domain/agents/agent-home.js';

const agentId = 'agent-a';

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: { text: string }[];
}>;

function grant(
  overrides: Partial<AuthorizedRuntimeToolContext> = {},
): AuthorizedRuntimeToolContext {
  return {
    grantId: 'grant-1',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    principalType: 'service_account',
    principalId: 'service-account-a',
    scopeId: 'chat-runtime-a',
    allowedTools: [
      AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
      AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
      AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
    ],
    catalogTools: [
      AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
      AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
      AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
    ],
    runtimeSession: {} as never,
    generation: {} as never,
    chatContext: {
      conversationId: 'conversation-a',
      triggerMessageId: 'message-a',
    },
    ...overrides,
  };
}

function register(input: {
  readonly current: AuthorizedRuntimeToolContext | null;
  readonly identity?: string | null;
  readonly identityError?: boolean;
  readonly catalogTools?: readonly string[];
  readonly entries?: Array<Record<string, unknown>>;
}): {
  readonly handlers: Map<string, Handler>;
  readonly configs: Map<string, Record<string, unknown>>;
  readonly calls: string[];
  readonly authorized: string[];
} {
  const handlers = new Map<string, Handler>();
  const configs = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const authorized: string[] = [];
  const entry = (path: string, content: string, version = 1) => ({
    id: `entry-${path}`,
    path,
    currentVersion: version,
    content,
    contentSha256: 'sha256',
    contentSizeBytes: Buffer.byteLength(content),
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
  });
  const entries: Array<ReturnType<typeof entry>> = (input.entries ?? [
    entry('notes/one.md', 'one'),
  ]) as Array<ReturnType<typeof entry>>;
  const current = input.current;
  const useCases = {
    list: {
      async execute(request: Record<string, unknown>) {
        calls.push('list');
        expect(request).toMatchObject({
          agentDefinitionId: input.identity ?? agentId,
          namespace: 'agent-shared',
          scopeParams: { workspaceId: 'workspace-a' },
        });
        return entries;
      },
    },
    read: {
      async execute(request: Record<string, unknown>) {
        calls.push(`read:${String(request.path)}`);
        if (String(request.path).includes('..'))
          throw new InvalidAgentHomePathError();
        const found = entries.find(
          (candidate) => candidate.path === request.path,
        );
        return found ?? null;
      },
    },
    write: {
      async execute(request: Record<string, unknown>) {
        calls.push(`write:${String(request.path)}`);
        return entry(String(request.path), String(request.content), 2);
      },
    },
  };
  const server = {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      handler: Handler,
    ) {
      handlers.set(name, handler);
      configs.set(name, config);
    },
  };
  registerAgentWorkspaceMcpTools({
    server: server as never,
    grant: grant({
      ...(input.catalogTools ? { catalogTools: input.catalogTools } : {}),
    }),
    async authorize(toolRef) {
      authorized.push(toolRef);
      return current;
    },
    agentHome: useCases as never,
    agentIdentities: {
      async resolve() {
        if (input.identityError) throw new Error('database details');
        return input.identity === undefined ? agentId : input.identity;
      },
    },
  });
  return { handlers, configs, calls, authorized };
}

describe('Coworker workspace MCP tools', () => {
  it('reauthorizes every call and derives the agent-shared scope from chat identity', async () => {
    const setup = register({ current: grant() });

    const listed = await setup.handlers.get('workspace_list')!({});
    const read = await setup.handlers.get('workspace_read')!({
      path: 'notes/one.md',
    });
    const written = await setup.handlers.get('workspace_write')!({
      path: 'notes/two.md',
      content: 'two',
    });

    expect(JSON.parse(listed.content[0]!.text).entries[0]).not.toHaveProperty(
      'content',
    );
    expect(JSON.parse(read.content[0]!.text).content).toBe('one');
    expect(JSON.parse(written.content[0]!.text)).not.toHaveProperty('content');
    expect(setup.authorized).toEqual([
      AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
      AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
      AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
    ]);
  });

  it('fails closed for missing, revoked, ambiguous, or failed identity', async () => {
    for (const options of [
      { current: grant({ chatContext: undefined } as never) },
      { current: grant(), identity: null },
      { current: grant(), identityError: true },
      { current: null },
    ]) {
      const setup = register(options);
      const result = await setup.handlers.get('workspace_write')?.({
        path: 'notes/nope.md',
        content: 'must not write',
      });
      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.text).toBe('not_found');
      expect(setup.calls).toEqual([]);
    }
  });

  it('rejects caller-selected agent or scope fields through strict schemas', () => {
    const setup = register({ current: grant() });
    const readSchema = setup.configs.get('workspace_read')?.inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const writeSchema = setup.configs.get('workspace_write')?.inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(
      readSchema.safeParse({ path: 'ok', agent_id: 'foreign' }).success,
    ).toBe(false);
    expect(
      writeSchema.safeParse({
        path: 'ok',
        content: 'ok',
        namespace: 'agent-shared',
        scope: 'foreign',
      }).success,
    ).toBe(false);
  });

  it('sanitizes path validation and repository failures', async () => {
    const setup = register({ current: grant() });
    const traversal = await setup.handlers.get('workspace_read')!({
      path: '../secret',
    });
    expect(traversal.isError).toBe(true);
    expect(traversal.content[0]!.text).toBe('invalid_request');
    expect(traversal.content[0]!.text).not.toContain('secret');
  });
});
