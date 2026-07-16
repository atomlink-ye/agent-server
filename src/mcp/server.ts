import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { paseoClient } from '../paseo-client/singleton.js'

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'agent-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  const tools = [
    {
      name: 'create_agent',
      description: 'Create a new AI agent with a given prompt. Returns the agent info including its ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string', description: 'The task or prompt for the agent' },
          provider: { type: 'string', enum: ['claude', 'codex', 'opencode'], default: 'claude', description: 'AI provider' },
          model: { type: 'string', description: 'Model identifier, e.g. claude-sonnet-4-20250514' },
          cwd: { type: 'string', description: 'Working directory for the agent' },
          mode: { type: 'string', enum: ['default', 'plan', 'bypassPermissions'], default: 'default', description: 'Agent permission mode' },
          systemPrompt: { type: 'string', description: 'Optional system prompt override' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'list_agents',
      description: 'List all active agents managed by this server.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'get_agent',
      description: 'Get the current status and details of a specific agent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'The agent ID to query' },
        },
        required: ['agent_id'],
      },
    },
    {
      name: 'send_prompt',
      description: 'Send a new prompt/task to an existing running agent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'The agent ID to send the prompt to' },
          prompt: { type: 'string', description: 'The prompt text to send' },
        },
        required: ['agent_id', 'prompt'],
      },
    },
    {
      name: 'stop_agent',
      description: 'Stop a running agent and archive it.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          agent_id: { type: 'string', description: 'The agent ID to stop' },
        },
        required: ['agent_id'],
      },
    },
  ]

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      switch (name) {
        case 'create_agent': {
          const { prompt, provider, model, cwd, mode, systemPrompt } = args as Record<string, string | undefined>
          const agent = await paseoClient.createAgent({
            prompt: prompt!,
            provider,
            model,
            cwd,
            mode,
            systemPrompt,
          })
          return { content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }] }
        }
        case 'list_agents': {
          const agents = await paseoClient.listAgents()
          return { content: [{ type: 'text', text: JSON.stringify(agents, null, 2) }] }
        }
        case 'get_agent': {
          const { agent_id } = args as { agent_id: string }
          const agent = await paseoClient.getAgent(agent_id)
          return { content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }] }
        }
        case 'send_prompt': {
          const { agent_id, prompt } = args as { agent_id: string; prompt: string }
          await paseoClient.sendPrompt(agent_id, prompt)
          return { content: [{ type: 'text', text: `Prompt sent to agent ${agent_id}` }] }
        }
        case 'stop_agent': {
          const { agent_id } = args as { agent_id: string }
          await paseoClient.stopAgent(agent_id)
          await paseoClient.archiveAgent(agent_id)
          return { content: [{ type: 'text', text: `Agent ${agent_id} stopped and archived` }] }
        }
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
      }
    } catch (err: any) {
      return { content: [{ type: 'text', text: err.message }], isError: true }
    }
  })

  return server
}
