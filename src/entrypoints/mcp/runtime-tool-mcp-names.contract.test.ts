import { describe, expect, it } from 'vitest';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import {
  AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
  AGENT_SERVER_WHISPER_SEND_TOOL_REF,
  AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
  AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
  AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF,
  AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF,
} from '../../application/agents/built-in-skills.js';
import { runtimeToolMcpNames } from '../../application/agents/runtime-tool-mcp-names.js';
import { registerAgentWorkspaceMcpTools } from './agent-workspace-mcp-tools.js';
import { registerWorkOrganizationMcpTools } from './work-organization-mcp-tools.js';
import { registerWhisperMcpTools } from './whisper-mcp-tools.js';

/**
 * The Chat prompt tells the Agent which tool names it holds, and the Agent
 * cannot reach a name the Runtime MCP endpoint never registers. This pins the
 * one direction that turns a naming drift into a hallucinated capability.
 */
describe('runtime tool MCP names', () => {
  it('names only tools the coworker default contributors actually register', () => {
    const toolRefs = [
      AGENT_SERVER_WORKSPACE_LIST_TOOL_REF,
      AGENT_SERVER_WORKSPACE_READ_TOOL_REF,
      AGENT_SERVER_WORKSPACE_WRITE_TOOL_REF,
      AGENT_SERVER_WORK_ITEM_CLAIM_TOOL_REF,
      AGENT_SERVER_WORK_ITEM_COMMENT_TOOL_REF,
      AGENT_SERVER_WORK_ITEM_STATUS_TOOL_REF,
      AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
      AGENT_SERVER_WHISPER_SEND_TOOL_REF,
    ];
    const registered: string[] = [];
    const server = {
      registerTool: (name: string) => {
        registered.push(name);
      },
    } as never;
    const grant = {
      catalogTools: toolRefs,
      allowedTools: toolRefs,
      chatContext: {
        conversationId: 'conversation-a',
        triggerMessageId: 'message-a',
      },
    } as unknown as AuthorizedRuntimeToolContext;
    const authorize = async () => grant;
    const unusedDependency = new Proxy({}, { get: () => () => undefined });

    registerAgentWorkspaceMcpTools({
      server,
      grant,
      authorize,
      agentHome: unusedDependency as never,
      agentIdentities: unusedDependency as never,
    });
    registerWorkOrganizationMcpTools({
      server,
      grant,
      authorize,
      service: unusedDependency as never,
      agentIdentities: unusedDependency as never,
    });
    registerWhisperMcpTools({
      server,
      grant,
      authorize,
      repository: unusedDependency as never,
      agentIdentities: unusedDependency as never,
    });

    expect(registered.toSorted()).toEqual([...runtimeToolMcpNames(toolRefs)]);
  });
});
