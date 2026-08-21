import { afterEach, describe, expect, it } from 'vitest';

import {
  AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
  AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
} from '../../src/application/agents/built-in-skills.js';
import { registerProductWorkMcpTools } from '../../src/entrypoints/mcp/product-work-mcp-tools.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.js';
import {
  createAgentServerHarness,
  type AgentServerHarness,
} from '../harness/agent-server-harness.js';

const harnesses: AgentServerHarness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

describe('North Star runtime grant boundary', () => {
  it('rejects scripted start_work when only workflow discovery is granted', async () => {
    const h = await createAgentServerHarness();
    harnesses.push(h);
    const definitionId = '00000000-0000-4000-8000-000000000202';
    const versionId = '00000000-0000-4000-8000-000000000203';
    const definitions = {
      async listDefinitionsForAgent() {
        return [{ id: definitionId, name: 'OpenAI analysis', description: null }];
      },
      async listProductVersions() {
        return {
          items: [
            {
              version: {
                id: versionId,
                definitionId,
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
        return { version: { id: versionId, definitionId } };
      },
      async findDefinition() {
        return { id: definitionId, name: 'OpenAI analysis' };
      },
    };
    const mcp = h.mcp.track(
      new RuntimeMcpServer(
        new RuntimeToolRegistry([
          ({ server, grant, grants }) =>
            registerProductWorkMcpTools({
              server,
              grant,
              grants,
              definitions: definitions as any,
              workIdentity: {
                async createWork() {
                  throw new Error('must not create');
                },
                async findWorkById() {
                  return null;
                },
                async findLatestWorkRun() {
                  return null;
                },
              },
              startWorkRun: {
                async execute() {
                  throw new Error('must not start');
                },
              },
            }),
        ]),
      ),
    );
    const receipt = mcp.grants.issue({
      tenantId: 'tenant-grant',
      workspaceId: 'workspace-grant',
      principalType: 'service_account',
      principalId: 'principal-grant',
      scopeId: 'chat-runtime-grant',
      allowedTools: [AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF],
      catalogTools: [
        AGENT_SERVER_LIST_AGENT_WORKFLOWS_TOOL_REF,
        AGENT_SERVER_PRODUCT_WORK_RUN_START_TOOL_REF,
      ],
    });
    const session = await h.runtime.createSession({
      runtimeSessionId: 'chat-runtime-grant',
      systemPrompt: 'Agent definition ID: agent-grant',
      mcpServer: mcp,
      token: receipt.token,
    });

    await expect(
      session.session.run({
        runId: 'grant-denial',
        prompt: '请做正式分析 OpenAI',
      }),
    ).rejects.toThrow('start_work');
  });
});
