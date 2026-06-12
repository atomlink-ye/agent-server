import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { paseoClient } from '../paseo-client/singleton.js'

export function createMcpServer(): McpServer {
  const mcp = new McpServer(
    { name: 'agent-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  // ─── Tools ──────────────────────────────────────────────────────────────────

  mcp.tool(
    'create_agent',
    'Create a new AI agent with a given prompt. Returns the agent info including its ID.',
    {
      prompt: z.string().describe('The task or prompt for the agent'),
      provider: z.enum(['claude', 'codex', 'opencode']).default('claude').describe('AI provider'),
      model: z.string().optional().describe('Model identifier, e.g. claude-sonnet-4-20250514'),
      cwd: z.string().optional().describe('Working directory for the agent'),
      mode: z.enum(['default', 'plan', 'bypassPermissions']).default('default').describe('Agent permission mode'),
      systemPrompt: z.string().optional().describe('Optional system prompt override'),
    },
    async ({ prompt, provider, model, cwd, mode, systemPrompt }) => {
      const agent = await paseoClient.createAgent({ prompt, provider, model, cwd, mode, systemPrompt })
      return {
        content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }],
      }
    },
  )

  mcp.tool(
    'list_agents',
    'List all active agents managed by this server.',
    {},
    async () => {
      const agents = await paseoClient.listAgents()
      return {
        content: [{ type: 'text', text: JSON.stringify(agents, null, 2) }],
      }
    },
  )

  mcp.tool(
    'get_agent',
    'Get the current status and details of a specific agent.',
    {
      agent_id: z.string().describe('The agent ID to query'),
    },
    async ({ agent_id }) => {
      const agent = await paseoClient.getAgent(agent_id)
      return {
        content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }],
      }
    },
  )

  mcp.tool(
    'send_prompt',
    'Send a new prompt/task to an existing running agent.',
    {
      agent_id: z.string().describe('The agent ID to send the prompt to'),
      prompt: z.string().describe('The prompt text to send'),
    },
    async ({ agent_id, prompt }) => {
      await paseoClient.sendPrompt(agent_id, prompt)
      return {
        content: [{ type: 'text', text: `Prompt sent to agent ${agent_id}` }],
      }
    },
  )

  mcp.tool(
    'stop_agent',
    'Stop a running agent and archive it.',
    {
      agent_id: z.string().describe('The agent ID to stop'),
    },
    async ({ agent_id }) => {
      await paseoClient.stopAgent(agent_id)
      await paseoClient.archiveAgent(agent_id)
      return {
        content: [{ type: 'text', text: `Agent ${agent_id} stopped and archived` }],
      }
    },
  )

  return mcp
}
