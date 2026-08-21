import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../../src/application/agents/built-in-skills.js';
import { ScriptedExecutionPlane } from '../../src/adapters/runtime/scripted-execution-plane.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.js';

const servers: RuntimeMcpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('North Star chat Work MVE', () => {
  it('turn2 calls the granted MCP list and start tools deterministically', async () => {
    const calls: string[] = [];
    const mcp = new RuntimeMcpServer(
      new RuntimeToolRegistry([
        ({ server, grant, grants }) => {
          (server.registerTool as any)(
            'list_agent_workflows',
            { inputSchema: z.object({ agent_definition_id: z.string() }) },
            async ({
              agent_definition_id,
            }: {
              agent_definition_id: string;
            }) => {
              expect(
                grants.isToolAllowed(
                  grant.grantId,
                  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
                ),
              ).toBe(true);
              calls.push(`list:${agent_definition_id}`);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      definitions: [
                        {
                          work_definition_version_id: 'workflow-version-1',
                          input_schema: {
                            type: 'object',
                            properties: { query: { type: 'string' } },
                            required: ['query'],
                          },
                        },
                      ],
                    }),
                  },
                ],
              };
            },
          );
          (server.registerTool as any)(
            'start_work',
            {
              inputSchema: z.object({
                work_definition_version_id: z.string(),
                input: z.record(z.string(), z.string()),
              }),
            },
            async ({
              work_definition_version_id,
              input,
            }: {
              work_definition_version_id: string;
              input: Record<string, string>;
            }) => {
              expect(
                grants.isToolAllowed(
                  grant.grantId,
                  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
                ),
              ).toBe(true);
              calls.push(`start:${work_definition_version_id}:${input.query}`);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      work_reference: { work_id: 'work-1' },
                    }),
                  },
                ],
              };
            },
          );
        },
      ]),
    );
    servers.push(mcp);
    const receipt = mcp.grants.issue({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
      scopeId: 'chat-runtime-1',
      allowedTools: [
        AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
        AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
    });
    const plane = new ScriptedExecutionPlane();
    const created = await plane.createSession({
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
      created.session.run({ runId: 'turn-2', prompt: '请做正式分析 OpenAI' }),
    ).resolves.toMatchObject({ status: 'completed' });
    expect(calls).toEqual([
      'list:agent-1',
      'start:workflow-version-1:请做正式分析 OpenAI',
    ]);
  });
});
