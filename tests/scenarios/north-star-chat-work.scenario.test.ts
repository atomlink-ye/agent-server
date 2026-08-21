import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../../src/application/agents/built-in-skills.js';
import { ScriptedExecutionPlane } from '../../src/adapters/runtime/scripted-execution-plane.js';
import { registerProductWorkMcpTools } from '../../src/entrypoints/mcp/product-work-mcp-tools.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.js';

const servers: RuntimeMcpServer[] = [];
afterEach(async () =>
  Promise.all(servers.splice(0).map((server) => server.stop())),
);

describe('North Star chat Work MVE', () => {
  it('turn2 invokes real work MCP handlers and creates a linked Work', async () => {
    const work = {
      id: '00000000-0000-4000-8000-000000000101',
      definitionId: '00000000-0000-4000-8000-000000000102',
      currentDefinitionVersionId: '00000000-0000-4000-8000-000000000103',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      title: 'OpenAI analysis',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      archivedAt: null,
    };
    const created: unknown[] = [];
    const started: unknown[] = [];
    const links: unknown[] = [];
    const definitions = {
      async listDefinitionsForAgent() {
        return [
          {
            id: work.definitionId,
            name: 'OpenAI analysis',
            description: 'Analyze OpenAI',
            owner: {
              tenantId: 'tenant-1',
              workspaceId: 'workspace-1',
              principalType: 'service_account',
              principalId: 'principal-1',
            },
          },
        ];
      },
      async listProductVersions() {
        return {
          items: [
            {
              version: {
                id: work.currentDefinitionVersionId,
                definitionId: work.definitionId,
                source: {
                  inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string' } },
                    required: ['query'],
                  },
                },
              },
            },
          ],
          nextCursor: null,
        };
      },
      async findProductVersion() {
        return {
          version: {
            id: work.currentDefinitionVersionId,
            definitionId: work.definitionId,
          },
        };
      },
      async findDefinition() {
        return { id: work.definitionId, name: 'OpenAI analysis' };
      },
    };
    const mcp = new RuntimeMcpServer(
      new RuntimeToolRegistry([
        ({ server, grant, grants }) =>
          registerProductWorkMcpTools({
            server,
            grant,
            grants,
            ...(grant.chatContext ? { chatContext: grant.chatContext } : {}),
            definitions: definitions as any,
            workIdentity: {
              async createWork(input) {
                created.push(input);
                return work as any;
              },
              async findWorkById() {
                return null;
              },
              async findLatestWorkRun() {
                return null;
              },
            },
            startWorkRun: {
              async execute(input) {
                started.push(input);
                return {
                  workRun: {
                    id: '00000000-0000-4000-8000-000000000104',
                    workId: work.id,
                  },
                  executionReceipt: {
                    reused: false,
                    taskId: '00000000-0000-4000-8000-000000000105',
                  },
                } as any;
              },
            },
            conversationWorkLinks: {
              async linkWorkToConversation(input) {
                links.push(input);
                return input as any;
              },
              async findConversationIdByWork() {
                return null;
              },
              async findRecentWorkByConversation() {
                return [];
              },
            },
          }),
      ]),
    );
    servers.push(mcp);
    const receipt = mcp.grants.issue({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
      scopeId: 'chat-runtime-1',
      chatContext: {
        conversationId: 'conversation-1',
        triggerMessageId: 'message-1',
      },
      allowedTools: [
        AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
        AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
    });
    const createdSession = await new ScriptedExecutionPlane().createSession({
      runtimeSessionId: 'chat-runtime-1',
      workspace: { cwd: process.cwd() },
      systemPrompt: 'Agent definition ID: agent-1',
      extensions: {
        mcpServers: [
          {
            name: 'agent-server',
            url: await mcp.start(),
            headers: { Authorization: `Bearer ${receipt.token}` },
          },
        ],
      },
    });
    await expect(
      createdSession.session.run({
        runId: 'turn-2',
        prompt: '请做正式分析 OpenAI',
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(created).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(links).toEqual([
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        workId: work.id,
        conversationId: 'conversation-1',
        triggerMessageId: 'message-1',
      },
    ]);
  });
});
