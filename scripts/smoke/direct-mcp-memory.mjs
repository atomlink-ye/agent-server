import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import {
  createDirectMemoryMcpHandler,
  MCP_PATH,
} from '../../src/entrypoints/mcp/direct-memory-mcp.ts';
import {
  AGENT_SERVER_MEMORY_READ_MCP_NAME,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  RuntimeToolGrantService,
} from '../../src/application/extensions/runtime-tool-grant-service.ts';

const storeId = randomUUID();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const memory = {
  id: randomUUID(),
  storeId,
  path: 'probe/result.txt',
  current: {
    id: randomUUID(),
    memoryId: randomUUID(),
    version: 1,
    content: 'PLATFORM_EXTENSION_MVE_OK',
    contentSha256: 'probe-sha256',
    contentSizeBytes: 27,
    operation: 'created',
    previousVersionId: null,
    createdAt: new Date().toISOString(),
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const store = {
  id: storeId,
  owner: {
    tenantId: 'tenant-mcp-probe',
    principalType: 'service_account',
    principalId: 'principal-mcp-probe',
    workspaceId,
  },
  name: 'probe',
  description: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const repository = {
  async getStore(id, principal) {
    if (id !== storeId || principal.tenantId !== store.owner.tenantId)
      return null;
    return store;
  },
  async listMemories(id) {
    return id === storeId ? [memory] : null;
  },
};
const grants = new RuntimeToolGrantService();
const good = grants.issue({
  tenantId: store.owner.tenantId,
  principalType: store.owner.principalType,
  principalId: store.owner.principalId,
  workspaceId,
  productSessionId: 'session-mcp-probe',
  allowedTools: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
});
const foreign = grants.issue({
  tenantId: store.owner.tenantId,
  principalType: store.owner.principalType,
  principalId: store.owner.principalId,
  workspaceId: otherWorkspaceId,
  productSessionId: 'session-mcp-foreign',
  allowedTools: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
});
const empty = grants.issue({
  tenantId: store.owner.tenantId,
  principalType: store.owner.principalType,
  principalId: store.owner.principalId,
  workspaceId,
  productSessionId: 'session-mcp-empty',
  allowedTools: [],
});

const server = createServer(
  createDirectMemoryMcpHandler({ repository, grants }),
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('probe listener failed');
const url = `http://127.0.0.1:${address.port}${MCP_PATH}`;
try {
  const wrong = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer wrong-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    }),
  });
  if (wrong.status !== 401) throw new Error('wrong token was not rejected');
  const oversized = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${good.token}`,
      'content-type': 'application/json',
    },
    body: 'x'.repeat(64 * 1024 + 1),
  });
  if (oversized.status !== 413)
    throw new Error('oversized request was not rejected');

  const goodClient = await connectClient(url, good.token);
  const tools = await goodClient.listTools();
  if (
    tools.tools.length !== 1 ||
    tools.tools[0]?.name !== AGENT_SERVER_MEMORY_READ_MCP_NAME
  )
    throw new Error('unexpected visible tool list');
  const result = await goodClient.callTool({
    name: AGENT_SERVER_MEMORY_READ_MCP_NAME,
    arguments: { memory_store_id: storeId, path: 'probe/result.txt' },
  });
  const text =
    result.content?.[0]?.type === 'text' ? result.content[0].text : '';
  if (!text.includes('PLATFORM_EXTENSION_MVE_OK'))
    throw new Error('marker was not returned');
  await goodClient.close();

  const foreignClient = await connectClient(url, foreign.token);
  const foreignResult = await foreignClient.callTool({
    name: AGENT_SERVER_MEMORY_READ_MCP_NAME,
    arguments: { memory_store_id: storeId, path: 'probe/result.txt' },
  });
  if (!JSON.stringify(foreignResult).includes('not_found'))
    throw new Error('foreign workspace was not hidden');
  await foreignClient.close();

  const emptyClient = await connectClient(url, empty.token);
  const emptyTools = await emptyClient.listTools();
  if (emptyTools.tools.length !== 0)
    throw new Error('unsupported tool was visible');
  await emptyClient.close();
  process.stdout.write(
    `${JSON.stringify({ success: true, marker: 'PLATFORM_EXTENSION_MVE_OK', visible_tools: 1, wrong_token_status: 401, oversized_status: 413, foreign_scope: 'not_found', unsupported_tools_visible: 0 })}\n`,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function connectClient(endpoint, token) {
  const client = new Client({ name: 'direct-mcp-probe', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}
