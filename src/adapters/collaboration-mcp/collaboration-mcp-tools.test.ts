import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CollaborationPolicyError } from '../../application/collaboration/collaboration-policy.js';
import {
  TeamContextError,
  type TeamToolContext,
} from '../../application/teams/team-tool-context.js';
import type { RuntimeToolGrant } from '../../application/extensions/runtime-tool-grant-service.js';
import {
  AGENT_SERVER_COLLABORATION_MCP_NAMES,
  AGENT_SERVER_COLLABORATION_TOOL_REFS,
  collaborationMcpName,
} from '../../domain/collaboration/canonical-collaboration-tools.js';
import { registerCollaborationMcpTools } from './collaboration-mcp-tools.js';

type Handler = (input: unknown) => Promise<unknown>;

function grant(
  grantId: string,
  activeTurn: RuntimeToolGrant['activeTurn'] = {
    taskId: 'task-1',
    runId: 'run-1',
    contextEpoch: 'epoch-1',
  },
): RuntimeToolGrant {
  return {
    grantId,
    tenantId: 'tenant-1',
    principalType: 'service_account',
    principalId: 'principal-1',
    workspaceId: 'workspace-1',
    productSessionId: 'member-1',
    teamMemberRunId: grantId,
    teamRunId: 'team-1',
    allowedTools: [],
    catalogTools: [],
    activeTurn,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

function context(): TeamToolContext {
  return {} as TeamToolContext;
}

function register(
  kernel: Record<string, unknown>,
  current = grant('member-1'),
) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
      return {};
    }),
  } as unknown as McpServer;
  const begin = vi.fn();
  const end = vi.fn();
  let currentGrant: RuntimeToolGrant | null = current;
  registerCollaborationMcpTools(server, {
    resolve: vi.fn(async () => context()),
    grantId: current.grantId,
    currentGrant: () => currentGrant,
    begin,
    end,
    kernel: kernel as never,
  });
  return {
    handlers,
    begin,
    end,
    close: () => {
      currentGrant = { ...current, activeTurn: null };
    },
  };
}

const registeredNames = Object.values(AGENT_SERVER_COLLABORATION_MCP_NAMES);

describe('Collaboration MCP wrapper', () => {
  it('normalizes bare and all Paseo MCP server-name shapes without a provider branch', () => {
    const name = AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCreate;
    expect([
      name,
      `mcp__agent-server__${name}`,
      `agent-server.${name}`,
      `agent-server_${name}`,
    ].map(collaborationMcpName)).toEqual([name, name, name, name]);
  });

  it('registers the same complete Collaboration surface for Lead and Member', () => {
    const lead = register({}, grant('lead-1'));
    const member = register({}, grant('member-1'));

    expect([...lead.handlers.keys()].sort()).toEqual(
      [...registeredNames].sort(),
    );
    expect([...member.handlers.keys()].sort()).toEqual(
      [...registeredNames].sort(),
    );
    expect(lead.handlers.size).toBe(
      Object.values(AGENT_SERVER_COLLABORATION_TOOL_REFS).length,
    );
  });

  it('maps member-to-lead mutation denial to typed not_allowed and fences the call', async () => {
    const kernel = {
      createWork: vi.fn(async () => {
        throw new CollaborationPolicyError('not_allowed');
      }),
    };
    const wrapper = register(kernel);

    const result = await wrapper.handlers.get('board_create')!({
      subject: 'forbidden',
    });

    expect(result).toMatchObject({
      structuredContent: { error: 'not_allowed' },
    });
    expect(wrapper.begin).toHaveBeenCalledWith('member-1');
    expect(wrapper.end).toHaveBeenCalledWith('member-1');
  });

  it('maps lead-to-member mutation denial to typed not_allowed', async () => {
    const kernel = {
      claimWork: vi.fn(async () => {
        throw new CollaborationPolicyError('not_allowed');
      }),
    };
    const wrapper = register(kernel, grant('lead-1'));

    const result = await wrapper.handlers.get('board_claim')!({
      work_ref: 'W-1',
    });

    expect(result).toMatchObject({
      structuredContent: { error: 'not_allowed' },
    });
    expect(wrapper.begin).toHaveBeenCalledOnce();
    expect(wrapper.end).toHaveBeenCalledOnce();
  });

  it('preserves typed invalid_transition errors from the kernel', async () => {
    const kernel = {
      acceptWork: vi.fn(async () => {
        throw new TeamContextError('invalid_transition');
      }),
    };
    const wrapper = register(kernel, grant('lead-1'));

    const result = await wrapper.handlers.get('board_accept')!({
      work_ref: 'W-1',
    });

    expect(result).toMatchObject({
      structuredContent: { error: 'invalid_transition' },
    });
    expect(wrapper.begin).toHaveBeenCalledOnce();
    expect(wrapper.end).toHaveBeenCalledOnce();
  });

  it('returns stale_state for a closed turn and still ends the active call', async () => {
    const wrapper = register({}, grant('member-1', null));
    const resolve = vi.fn(async () => {
      throw new TeamContextError('stale_state');
    });
    const registerTool = vi.fn(
      (_name: string, _config: unknown, handler: Handler) => handler,
    );
    const server = { registerTool } as unknown as McpServer;
    registerCollaborationMcpTools(server, {
      resolve,
      grantId: 'member-1',
      currentGrant: () => grant('member-1', null),
      begin: wrapper.begin,
      end: wrapper.end,
      kernel: {} as never,
    });
    const handler = registerTool.mock.calls.find(
      ([name]) => name === AGENT_SERVER_COLLABORATION_MCP_NAMES.boardList,
    )?.[2] as unknown as Handler;

    const result = await handler({});

    expect(result).toMatchObject({
      structuredContent: { error: 'stale_state' },
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(wrapper.begin).toHaveBeenCalledWith('member-1');
    expect(wrapper.end).toHaveBeenCalledWith('member-1');
  });
});
