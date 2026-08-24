import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthorizeRuntimeTool } from '../../application/runtime/authorize-runtime-tool.js';
import type { RuntimeToolCatalog } from '../../application/extensions/runtime-tool-catalog.js';
import type { Logger } from '../../shared/observability/logger.js';

export const MCP_PATH = '/mcp/agent-runtime';
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
type McpSession = Readonly<{
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
  readonly grantId: string;
}>;

export function createRuntimeMcpHttpHandler(input: {
  readonly authorize: AuthorizeRuntimeTool;
  readonly toolCatalog: RuntimeToolCatalog;
  readonly logger?: Logger;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const sessions = new Map<string, McpSession>();
  return async (req, res) => {
    if (req.url?.split('?')[0] !== MCP_PATH) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      if ((error as { code?: string }).code === 'request_too_large') {
        sendJson(res, 413, { error: 'request_too_large' });
        return;
      }
      sendJson(res, 400, { error: 'invalid_request' });
      return;
    }
    const bearer = readBearer(req);
    const requested = requestedTool(body);
    const method = requestedMethod(body);
    const mcpSessionIdForLog = mcpSessionIdHeader(req);
    // This outer gate is authentication-only, for every method including
    // `tools/call`: it proves the bearer is a live, correctly-scoped grant
    // for the current catalog shape (`executeDiscovery` ->
    // evaluateRuntimeGrantDiscoveryPolicy) and nothing more. It deliberately
    // never checks turn binding, turn activity, or per-tool allowance --
    // that is the job of the *inner* gate, which every registered tool goes
    // through on every real invocation via the `authorize` callback threaded
    // through `toolCatalog.contribute` below (see
    // runtime-tool-contributors.ts, product-work-mcp-tools.ts,
    // collaboration-mcp-tools.ts: each call re-authorizes with its own tool
    // REF through `AuthorizeRuntimeTool.execute` ->
    // evaluateRuntimeGrantPolicy). A single gate here that tried to
    // authorize a specific tool would have to compare the *registered MCP
    // tool NAME* carried in `params.name` (e.g. `list_agent_workflows`)
    // against `grant.allowedTools`, which stores tool REFs (e.g.
    // `agent-server/list-agent-workflows`) -- a comparison that can never
    // match. That mismatch is exactly the bug this fix removes. Also see
    // team-tool-context.ts: "Tool visibility is not an authorization input:
    // every call re-reads ... and validates the active-turn epoch."
    const authResult = bearer
      ? await input.authorize.executeDiscovery({
          bearerToken: bearer,
          currentCatalogDigest: input.toolCatalog.digest,
        })
      : null;
    if (!authResult || authResult.kind !== 'authorized') {
      // A missing bearer never reaches executeDiscovery(), so there is no
      // policy reason to attach beyond the fact that no credential was
      // presented. `method`/`requested_tool` record which JSON-RPC call hit
      // this gate -- a real per-tool denial now always happens at the inner
      // gate instead, where the tool REF (not the name logged here) is the
      // one that matters.
      input.logger?.log('warn', 'runtime.mcp.auth.denied', {
        bearer_present: bearer !== null,
        ...(authResult?.kind === 'denied' ? { reason: authResult.reason } : {}),
        ...(requested ? { requested_tool: requested } : {}),
        ...(method ? { method } : {}),
        ...(mcpSessionIdForLog ? { mcp_session_id: mcpSessionIdForLog } : {}),
      });
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const grant = authResult.context;
    const sessionId = req.headers['mcp-session-id'];
    if (Array.isArray(sessionId)) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const existing =
      typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (sessionId && !existing) {
      // A provider holding an MCP transport session the server has forgotten
      // looks like a mystery 404 without this: record which session id.
      input.logger?.log('warn', 'runtime.mcp.session.denied', {
        reason: 'mcp_session_unknown',
        mcp_session_id: sessionId,
      });
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (existing && existing.grantId !== grant.grantId) {
      // Distinct from an authorization denial: the MCP transport session
      // outlived the grant it was opened with (e.g. a new turn/grant issued
      // while the provider kept reusing the old session id).
      input.logger?.log('warn', 'runtime.mcp.session.denied', {
        reason: 'mcp_session_grant_changed',
        ...(typeof sessionId === 'string' ? { mcp_session_id: sessionId } : {}),
      });
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const server =
      existing?.server ??
      new McpServer({
        name: 'agent-server-memory-mcp',
        version: '0.1.0',
      });
    let transport!: StreamableHTTPServerTransport;
    transport =
      existing?.transport ??
      new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          sessions.set(id, {
            server,
            transport,
            grantId: grant.grantId,
          });
        },
      });
    if (!existing) {
      input.toolCatalog.contribute({
        server,
        grant,
        authorize: async (toolRef) => {
          const authorized = await input.authorize.execute({
            bearerToken: bearer!,
            requestedTool: toolRef,
            currentCatalogDigest: input.toolCatalog.digest,
          });
          if (authorized.kind === 'authorized') return authorized.context;
          // This is the gate that actually decides an invocation, and its
          // reason used to be discarded: the tool merely answered `not_found`,
          // so an operator saw a working transport refuse every call with no
          // way to tell a stale catalog digest from an unbound turn.
          input.logger?.log('warn', 'runtime.mcp.tool.denied', {
            reason: authorized.reason,
            tool_ref: toolRef,
          });
          return null;
        },
      });
    }
    const newSession = !existing;
    if (newSession) {
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id && sessions.get(id)?.transport === transport)
          sessions.delete(id);
      };
    }
    try {
      if (newSession)
        await server.connect(transport as Parameters<typeof server.connect>[0]);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      if (newSession) {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }
    }
    if (newSession && !transport.sessionId) {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  };
}

function readBearer(req: IncomingMessage): string | null {
  const value = req.headers.authorization;
  if (!value || !/^Bearer\s+[^\s]+$/i.test(value)) return null;
  return value.slice(value.indexOf(' ') + 1).trim();
}

function requestedTool(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const params = Reflect.get(body, 'params');
  if (!params || typeof params !== 'object' || Array.isArray(params))
    return null;
  const name = Reflect.get(params, 'name');
  return typeof name === 'string' ? name : null;
}

function requestedMethod(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const method = Reflect.get(body, 'method');
  return typeof method === 'string' ? method : null;
}

function mcpSessionIdHeader(req: IncomingMessage): string | null {
  const value = req.headers['mcp-session-id'];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw : null;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('request too large') as Error & {
          code: string;
        };
        error.code = 'request_too_large';
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid request'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
