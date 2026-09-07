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
    let method: string | null = null;
    let requested: string | null = null;
    let mcpSessionIdForLog: string | null = null;
    let newSession = false;
    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    try {
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
      requested = requestedTool(body);
      method = requestedMethod(body);
      mcpSessionIdForLog = mcpSessionIdHeader(req);
      // This outer gate is authentication-only, for every method including
      // `tools/call`: it proves the bearer is a live, correctly-scoped grant
      // for the current catalog shape (`executeDiscovery` ->
      // evaluateRuntimeGrantDiscoveryPolicy) and nothing more. It deliberately
      // never checks turn binding, turn activity, or per-tool allowance --
      // that is the job of the *inner* gate, which every registered tool goes
      // through on every real invocation via the `authorize` callback threaded
      // through `toolCatalog.contribute` below.
      const authResult = bearer
        ? await input.authorize.executeDiscovery({
            bearerToken: bearer,
            currentCatalogDigest: input.toolCatalog.digest,
          })
        : null;
      if (!authResult || authResult.kind !== 'authorized') {
        input.logger?.log('warn', 'runtime.mcp.auth.denied', {
          bearer_present: bearer !== null,
          ...(authResult?.kind === 'denied'
            ? { reason: authResult.reason }
            : {}),
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
        input.logger?.log('warn', 'runtime.mcp.session.denied', {
          reason: 'mcp_session_unknown',
          mcp_session_id: sessionId,
        });
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      if (existing && existing.grantId !== grant.grantId) {
        input.logger?.log('warn', 'runtime.mcp.session.denied', {
          reason: 'mcp_session_grant_changed',
          ...(typeof sessionId === 'string'
            ? { mcp_session_id: sessionId }
            : {}),
        });
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const mcpServer =
        existing?.server ??
        new McpServer({
          name: 'agent-server-memory-mcp',
          version: '0.1.0',
        });
      server = mcpServer;
      transport =
        existing?.transport ??
        new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            sessions.set(id, {
              server: mcpServer,
              transport: transport!,
              grantId: grant.grantId,
            });
          },
        });
      newSession = !existing;
      if (!existing) {
        input.toolCatalog.contribute({
          server: mcpServer,
          grant,
          authorize: async (toolRef) => {
            const authorized = await input.authorize.execute({
              bearerToken: bearer!,
              requestedTool: toolRef,
              currentCatalogDigest: input.toolCatalog.digest,
            });
            if (authorized.kind === 'authorized') return authorized.context;
            input.logger?.log('warn', 'runtime.mcp.tool.denied', {
              reason: authorized.reason,
              tool_ref: toolRef,
            });
            return null;
          },
        });
      }
      if (newSession) {
        transport.onclose = () => {
          const id = transport?.sessionId;
          if (id && sessions.get(id)?.transport === transport)
            sessions.delete(id);
        };
      }
      if (newSession)
        await mcpServer.connect(
          transport as Parameters<typeof mcpServer.connect>[0],
        );
      await transport.handleRequest(req, res, body);
      if (newSession && !transport.sessionId) {
        await transport.close().catch(() => undefined);
        await mcpServer.close().catch(() => undefined);
      }
    } catch {
      try {
        input.logger?.log('error', 'runtime.mcp.request.failed');
      } catch {
        // Logging must not turn a controlled request failure into a rejection.
      }
      try {
        if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
        else if (!res.writableEnded) res.destroy();
      } catch {
        // The client may have already disconnected while the failure was
        // being handled; there is no second response to send in that case.
      }
      if (newSession && transport) {
        await transport.close().catch(() => undefined);
        await server?.close().catch(() => undefined);
      }
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
