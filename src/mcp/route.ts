import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from './server.js'

export const mcpRoute = new Hono()

// Session management: map sessionId → transport
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>()

function getOrCreateTransport(sessionId: string | null): WebStandardStreamableHTTPServerTransport {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, transport)
      console.log(`[mcp] Session initialized: ${id}`)
    },
    onsessionclosed: (id) => {
      sessions.delete(id)
      console.log(`[mcp] Session closed: ${id}`)
    },
  })

  // Connect a fresh MCP server to this transport
  const mcp = createMcpServer()
  mcp.connect(transport)

  return transport
}

// Handle all MCP requests (POST for JSON-RPC, GET for SSE stream, DELETE for session close)
mcpRoute.all('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id') || null

  // For non-initialization requests, session must exist
  if (sessionId && !sessions.has(sessionId) && c.req.method !== 'POST') {
    return c.json({ error: 'Session not found' }, 404)
  }

  const transport = getOrCreateTransport(sessionId)
  const response = await transport.handleRequest(c.req.raw)
  return response
})
