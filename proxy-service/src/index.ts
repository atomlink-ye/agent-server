import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { randomUUID } from 'crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from './mcp-server.js'

const app = new Hono()
const PORT = Number(process.env.PORT) || 3000

// Session management
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

  const mcp = createMcpServer()
  mcp.connect(transport)

  return transport
}

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'proxy-service', version: '1.0.0' }))

// MCP endpoint at root - handles POST (JSON-RPC), GET (SSE), DELETE (session close)
app.all('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id') || null

  if (sessionId && !sessions.has(sessionId) && c.req.method !== 'POST') {
    return c.json({ error: 'Session not found' }, 404)
  }

  const transport = getOrCreateTransport(sessionId)
  return transport.handleRequest(c.req.raw)
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Proxy Service MCP running on http://0.0.0.0:${info.port}`)
  console.log(`  Health: http://0.0.0.0:${info.port}/health`)
  console.log(`  MCP:    http://0.0.0.0:${info.port}/`)
})
