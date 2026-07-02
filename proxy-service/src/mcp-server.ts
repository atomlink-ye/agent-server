import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'proxy-service', version: '1.0.0' },
    { capabilities: { tools: { listChanged: true } } },
  )

  const tools = [
    {
      name: 'hello',
      description: 'A simple hello world tool to verify proxy service connectivity',
      inputSchema: {
        type: 'object' as const,
        properties: { name: { type: 'string', description: 'Name to greet (optional)' } },
      },
    },
    {
      name: 'echo',
      description: 'Echo back the input - useful for testing request/response flow',
      inputSchema: {
        type: 'object' as const,
        properties: { message: { type: 'string', description: 'Message to echo back' } },
        required: ['message'],
      },
    },
    {
      name: 'info',
      description: 'Return proxy service runtime information',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ]

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    switch (name) {
      case 'hello': {
        const n = (args as Record<string, string>)?.name
        const text = n
          ? `Hello, ${n}! Proxy service is working.`
          : 'Hello from proxy service! Connectivity verified.'
        return { content: [{ type: 'text', text }] }
      }
      case 'echo': {
        const msg = (args as Record<string, string>)?.message || ''
        return { content: [{ type: 'text', text: `[proxy-service echo] ${msg}` }] }
      }
      case 'info': {
        const info = {
          service: 'proxy-service',
          version: '1.0.0',
          node: process.version,
          platform: process.platform,
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        }
        return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] }
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  })

  return server
}
