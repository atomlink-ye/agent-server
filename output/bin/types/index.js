import { z } from 'zod';
// Request schemas
export const CreateAgentSchema = z.object({
    prompt: z.string().min(1),
    provider: z.string().default('claude'),
    model: z.string().optional(),
    cwd: z.string().optional(),
    mode: z.enum(['default', 'plan', 'bypassPermissions']).default('default'),
    systemPrompt: z.string().optional(),
});
export const SendPromptSchema = z.object({
    prompt: z.string().min(1),
});
//# sourceMappingURL=index.js.map