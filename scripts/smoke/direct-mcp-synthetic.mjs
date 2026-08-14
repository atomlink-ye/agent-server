import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createDirectMemoryMcpHandler,
  MCP_PATH,
} from '../../src/entrypoints/mcp/direct-memory-mcp.ts';
import { createLegacyRuntimeToolsContributor } from '../../src/entrypoints/mcp/runtime-tool-contributors.ts';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.ts';
import { SyntheticMarketAdapter } from '../../src/adapters/demo-market/synthetic-market-adapter.ts';
import { RuntimeToolGrantService } from '../../src/application/extensions/runtime-tool-grant-service.ts';
import { AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF } from '../../src/application/agents/built-in-skills.ts';

const fixtureRef = 'fixture://self-learning-market-research/acme-v1';
const workspaceId = randomUUID();
const grants = new RuntimeToolGrantService();
const grant = grants.issue({
  tenantId: 'tenant-mcp-synthetic-probe',
  principalType: 'service_account',
  principalId: 'principal-mcp-synthetic-probe',
  workspaceId,
  productSessionId: 'session-mcp-synthetic-probe',
  allowedTools: [AGENT_SERVER_SYNTHETIC_STOCK_SNAPSHOT_TOOL_REF],
});
const repository = {
  async getStore() {
    return null;
  },
  async listMemories() {
    return null;
  },
};
const server = createServer(
  createDirectMemoryMcpHandler({
    grants,
    registry: new RuntimeToolRegistry([
      createLegacyRuntimeToolsContributor({
        repository,
        market: new SyntheticMarketAdapter(),
      }),
    ]),
  }),
);

const startedAt = Date.now();
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('probe_listener_failed');
  const endpoint = `http://127.0.0.1:${address.port}${MCP_PATH}`;
  const client = new Client({
    name: 'direct-mcp-synthetic-probe',
    version: '0.1.0',
  });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: `Bearer ${grant.token}` } },
  });
  const initializeStartedAt = Date.now();
  await client.connect(transport);
  const initializeMs = Date.now() - initializeStartedAt;
  const listStartedAt = Date.now();
  const tools = await client.listTools();
  const listMs = Date.now() - listStartedAt;
  const visibleToolNames = tools.tools.map((tool) => tool.name);
  if (
    visibleToolNames.length !== 1 ||
    visibleToolNames[0] !== 'synthetic_stock_snapshot'
  )
    throw new Error('unexpected_visible_tool_names');
  const callStartedAt = Date.now();
  const result = await Promise.race([
    client.callTool({
      name: 'synthetic_stock_snapshot',
      arguments: { fixture_ref: fixtureRef, symbol: 'ACME' },
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('synthetic_call_timeout')), 5000),
    ),
  ]);
  const callMs = Date.now() - callStartedAt;
  const structuredContent = result.structuredContent ?? null;
  if (structuredContent?.synthetic !== true)
    throw new Error('synthetic_structured_content_missing');
  await client.close();
  console.log(
    JSON.stringify({
      success: true,
      initialize_ms: initializeMs,
      list_tools_ms: listMs,
      call_ms: callMs,
      visible_tool_names: visibleToolNames,
      structured_content: true,
      synthetic: structuredContent.synthetic,
      elapsed_ms: Date.now() - startedAt,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'probe_failed',
      elapsed_ms: Date.now() - startedAt,
    }),
  );
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve)).catch(() => undefined);
}
