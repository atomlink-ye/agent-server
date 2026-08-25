import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createRuntimeMcpHttpHandler } from './runtime-mcp-http-handler.js';
import { AuthorizeRuntimeTool } from '../../application/runtime/authorize-runtime-tool.js';
import { createRuntimeToolCatalog } from '../../application/extensions/runtime-tool-catalog.js';
import type {
  RuntimeGrantReader,
  RuntimeGrantRecord,
} from '../../application/ports/runtime-grant-reader.js';
import type { RuntimeSessionStore } from '../../application/ports/runtime-session-store.js';
import type { RuntimeGenerationStore } from '../../application/ports/runtime-generation-store.js';
import type { RuntimeTurnStore } from '../../application/ports/runtime-turn-store.js';
import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import type { RuntimeTurn } from '../../domain/runtime/runtime-turn.js';
import type { Logger, LogLevel } from '../../shared/observability/logger.js';

/**
 * Reproduces the real failure this fix addresses end-to-end over an actual
 * HTTP + MCP transport: the outer gate must authenticate every method
 * (including `tools/call`) without ever comparing a registered MCP tool
 * NAME against `grant.allowedTools`, which stores tool REFs -- that
 * comparison can never match (see runtime-mcp-http-handler.ts). The inner
 * per-tool `authorize` callback remains the only place a real invocation is
 * authorized, and it must still deny a tool that is not in `allowedTools`.
 */

const now = new Date('2026-08-24T00:05:00.000Z');
const bearerToken = 'bearer-token-e2e';
const hashBearer = (token: string) => `hashed:${token}`;
const TOOL_REF = 'test/tool-one';
const TOOL_NAME = 'test_tool_one';

function session(): RuntimeSession {
  return {
    id: 'session-1',
    owner: {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
    },
    scope: { kind: 'product_session', id: 'scope-1' },
    desiredSpecRevision: 1,
    currentGenerationId: 'generation-1',
    status: 'ready',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    closedAt: null,
  } as RuntimeSession;
}

function generation(): RuntimeSessionGeneration {
  return {
    id: 'generation-1',
    runtimeSessionId: 'session-1',
    generation: 1,
    provider: 'paseo',
    providerWorkspaceId: 'provider-workspace-1',
    providerSessionId: 'provider-session-1',
    appliedSpecRevision: 1,
    appliedBootstrapDigest: 'sha256:bootstrap',
    endpointEpoch: 'epoch-1',
    status: 'active',
    createdAt: '2026-08-24T00:00:00.000Z',
    activeAt: '2026-08-24T00:00:00.000Z',
    supersededAt: null,
    closedAt: null,
  } as RuntimeSessionGeneration;
}

function turn(): RuntimeTurn {
  return {
    id: 'turn-1',
    runtimeSessionId: 'session-1',
    source: { kind: 'run', runId: 'run-1' },
    generationId: 'generation-1',
    status: 'running',
    promptDigest: null,
    failureCode: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    startedAt: '2026-08-24T00:00:00.000Z',
    completedAt: null,
  } as RuntimeTurn;
}

/** Mutable so a test can simulate the grant narrowing after the MCP session (and its one-time tool registration) already exists. */
function mutableGrantReader(initial: RuntimeGrantRecord): {
  readonly reader: RuntimeGrantReader;
  setAllowedTools(tools: readonly string[]): void;
} {
  let current = initial;
  return {
    reader: {
      findByTokenHash: async () => current,
      findById: async () => current,
    },
    setAllowedTools(tools: readonly string[]) {
      current = { ...current, allowedTools: tools };
    },
  };
}

function sessionStore(): RuntimeSessionStore {
  const fail = async () => {
    throw new Error('not used in this test');
  };
  return {
    findById: async () => session(),
    findByScope: fail,
    createWithInitialSpec: fail,
    bindCurrentGeneration: fail,
    markStatus: fail,
    close: fail,
  };
}

function generationStore(): RuntimeGenerationStore {
  const fail = async () => {
    throw new Error('not used in this test');
  };
  return {
    findById: async () => generation(),
    findCurrent: fail,
    insert: fail,
    updateAppliedSpec: fail,
    supersede: fail,
    failProvisioning: fail,
    close: fail,
  };
}

function turnStore(): RuntimeTurnStore {
  const fail = async () => {
    throw new Error('not used in this test');
  };
  return {
    createPending: fail,
    findById: async () => turn(),
    bindGenerationAndPrepare: fail,
    start: fail,
    succeed: fail,
    fail: fail,
    cancelBeforeRun: fail,
    cancelRunning: fail,
  };
}

function capturingLogger(): {
  readonly logger: Logger;
  readonly entries: { level: LogLevel; event: string; attributes?: unknown }[];
} {
  const entries: { level: LogLevel; event: string; attributes?: unknown }[] =
    [];
  return {
    logger: {
      log: (level, event, attributes) => {
        entries.push({ level, event, attributes });
      },
    },
    entries,
  };
}

async function startServer(
  handler: ReturnType<typeof createRuntimeMcpHttpHandler>,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test MCP listener failed to bind.');
  return {
    server,
    url: `http://127.0.0.1:${address.port}/mcp/agent-runtime`,
  };
}

describe('createRuntimeMcpHttpHandler (outer gate is authentication-only)', () => {
  let server: Server | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    if (server?.listening)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    client = undefined;
  });

  it('lets a real tools/call reach the registered tool when the grant does allow it', async () => {
    const toolCatalog = createRuntimeToolCatalog([
      {
        ref: 'test-catalog',
        toolRefs: [TOOL_REF],
        contribute: ({ server: mcpServer, grant, authorize }) => {
          if (!grant.catalogTools.includes(TOOL_REF)) return;
          (mcpServer.registerTool as any)(
            TOOL_NAME,
            { description: 'test tool', inputSchema: {} },
            async () => {
              const current = await authorize(TOOL_REF);
              if (!current)
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ error: 'not_found' }),
                    },
                  ],
                  structuredContent: { error: 'not_found' },
                };
              return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
                structuredContent: { ok: true },
              };
            },
          );
        },
      },
    ]);
    const grantRecord: RuntimeGrantRecord = {
      id: 'grant-1',
      runtimeSessionId: 'session-1',
      generationId: 'generation-1',
      runtimeTurnId: 'turn-1',
      tokenHash: hashBearer(bearerToken),
      catalogDigest: toolCatalog.digest,
      allowedTools: [TOOL_REF],
      expiresAt: '2026-08-24T00:10:00.000Z',
      revokedAt: null,
    } as unknown as RuntimeGrantRecord;
    const { reader } = mutableGrantReader(grantRecord);
    const authorize = new AuthorizeRuntimeTool(
      reader,
      sessionStore(),
      generationStore(),
      turnStore(),
      hashBearer,
      () => now,
    );
    const started = await startServer(
      createRuntimeMcpHttpHandler({ authorize, toolCatalog }),
    );
    server = started.server;
    client = new Client({
      name: 'runtime-mcp-http-handler.test',
      version: '1',
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url), {
        requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } },
      }) as never,
    );

    const result = (await client.callTool({
      name: TOOL_NAME,
      arguments: {},
    })) as {
      isError?: boolean;
      content: readonly { type: string; text?: string }[];
    };

    expect(result.isError).toBeFalsy();
    const text = result.content.find((item) => item.type === 'text')?.text;
    expect(text && JSON.parse(text)).toEqual({ ok: true });
  });

  it('still fails a tools/call naming a tool absent from allowedTools, even though the outer gate is now permissive to tool identity', async () => {
    const toolCatalog = createRuntimeToolCatalog([
      {
        ref: 'test-catalog',
        toolRefs: [TOOL_REF],
        contribute: ({ server: mcpServer, grant, authorize }) => {
          if (!grant.catalogTools.includes(TOOL_REF)) return;
          (mcpServer.registerTool as any)(
            TOOL_NAME,
            { description: 'test tool', inputSchema: {} },
            async () => {
              const current = await authorize(TOOL_REF);
              if (!current)
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ error: 'not_found' }),
                    },
                  ],
                  structuredContent: { error: 'not_found' },
                };
              return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
                structuredContent: { ok: true },
              };
            },
          );
        },
      },
    ]);
    const grantRecord: RuntimeGrantRecord = {
      id: 'grant-1',
      runtimeSessionId: 'session-1',
      generationId: 'generation-1',
      runtimeTurnId: 'turn-1',
      tokenHash: hashBearer(bearerToken),
      catalogDigest: toolCatalog.digest,
      allowedTools: [TOOL_REF],
      expiresAt: '2026-08-24T00:10:00.000Z',
      revokedAt: null,
    } as unknown as RuntimeGrantRecord;
    const { reader, setAllowedTools } = mutableGrantReader(grantRecord);
    const authorize = new AuthorizeRuntimeTool(
      reader,
      sessionStore(),
      generationStore(),
      turnStore(),
      hashBearer,
      () => now,
    );
    const { logger, entries } = capturingLogger();
    const started = await startServer(
      createRuntimeMcpHttpHandler({ authorize, toolCatalog, logger }),
    );
    server = started.server;
    client = new Client({
      name: 'runtime-mcp-http-handler.test',
      version: '1',
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url), {
        requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } },
      }) as never,
    );

    // The tool is already registered on this MCP session from the grant at
    // connect time. Narrow the durable grant afterward -- e.g. a rotation
    // onto a different turn scope -- so the *next* real invocation must be
    // caught by the inner per-tool re-authorization, not by tool identity
    // at the outer gate (which never inspected it in the first place).
    setAllowedTools([]);

    const result = (await client.callTool({
      name: TOOL_NAME,
      arguments: {},
    })) as {
      isError?: boolean;
      content: readonly { type: string; text?: string }[];
    };

    // Denial happens inside the tool result, not as an HTTP-level/JSON-RPC
    // rejection of the request itself -- proof the outer gate let the
    // request through and the *inner* gate is what stopped it.
    const text = result.content.find((item) => item.type === 'text')?.text;
    expect(text && JSON.parse(text)).toEqual({ error: 'not_found' });
    // The outer authentication-only gate never denied anything here: the
    // bearer stayed valid throughout, so it has nothing to log.
    expect(
      entries.filter((entry) => entry.event === 'runtime.mcp.auth.denied'),
    ).toHaveLength(0);
  });
});
