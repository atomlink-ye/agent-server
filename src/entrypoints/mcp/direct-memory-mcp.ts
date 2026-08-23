import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  RuntimeToolGrantService,
  type RuntimeToolGrant,
} from '../../application/extensions/runtime-tool-grant-service.js';
import type { RuntimeToolCatalog } from '../../application/extensions/runtime-tool-catalog.js';

export const MCP_PATH = '/mcp/agent-runtime';
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
type McpSession = Readonly<{
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
  readonly grantId: string;
  readonly refreshTools: (allowedTools: readonly string[]) => void;
}>;

export function createDirectMemoryMcpHandler(input: {
  readonly grants: RuntimeToolGrantService;
  readonly toolCatalog: RuntimeToolCatalog;
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
    const grant = authenticate(req, input.grants);
    if (!grant) {
      sendJson(res, 401, { error: 'unauthorized' });
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
    const sessionId = req.headers['mcp-session-id'];
    if (Array.isArray(sessionId)) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const existing =
      typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (sessionId && !existing) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (existing && existing.grantId !== grant.grantId) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    const server =
      existing?.server ??
      new McpServer({
        name: 'agent-server-memory-mcp',
        version: '0.1.0',
      });
    let refreshTools: (allowedTools: readonly string[]) => void =
      existing?.refreshTools ?? (() => undefined);
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
            refreshTools,
          });
        },
      });
    if (!existing) {
      input.toolCatalog.contribute({
        server,
        grant,
        grants: input.grants,
        ...(grant.chatContext ? { chatContext: grant.chatContext } : {}),
      });
      refreshTools = (allowedTools) => {
        void allowedTools;
      };
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
        await server.connect(
          transport as unknown as Parameters<typeof server.connect>[0],
        );
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

function authenticate(
  req: IncomingMessage,
  grants: RuntimeToolGrantService,
): RuntimeToolGrant | null {
  const value = req.headers.authorization;
  if (!value || !/^Bearer\s+[^\s]+$/i.test(value)) return null;
  return grants.resolve(value.slice(value.indexOf(' ') + 1).trim());
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
