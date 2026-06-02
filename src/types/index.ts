import { z } from 'zod'

// Request schemas
export const CreateAgentSchema = z.object({
  prompt: z.string().min(1),
  provider: z.string().default('claude'),
  model: z.string().optional(),
  cwd: z.string().optional(),
  mode: z.enum(['default', 'plan', 'bypassPermissions']).default('default'),
  systemPrompt: z.string().optional(),
})

export const SendPromptSchema = z.object({
  prompt: z.string().min(1),
})

// Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

export interface AgentResponse {
  id: string
  provider: string
  status: string
  title?: string
  createdAt: string
  updatedAt: string
}

export type CreateAgentRequest = z.infer<typeof CreateAgentSchema>
export type SendPromptRequest = z.infer<typeof SendPromptSchema>
