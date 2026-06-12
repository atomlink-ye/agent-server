import { z } from 'zod';
export declare const CreateAgentSchema: z.ZodObject<{
    prompt: z.ZodString;
    provider: z.ZodDefault<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    cwd: z.ZodOptional<z.ZodString>;
    mode: z.ZodDefault<z.ZodEnum<["default", "plan", "bypassPermissions"]>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    prompt: string;
    provider: string;
    mode: "default" | "plan" | "bypassPermissions";
    model?: string | undefined;
    cwd?: string | undefined;
    systemPrompt?: string | undefined;
}, {
    prompt: string;
    provider?: string | undefined;
    model?: string | undefined;
    cwd?: string | undefined;
    mode?: "default" | "plan" | "bypassPermissions" | undefined;
    systemPrompt?: string | undefined;
}>;
export declare const SendPromptSchema: z.ZodObject<{
    prompt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    prompt: string;
}, {
    prompt: string;
}>;
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}
export interface AgentResponse {
    id: string;
    provider: string;
    status: string;
    title?: string;
    createdAt: string;
    updatedAt: string;
}
export type CreateAgentRequest = z.infer<typeof CreateAgentSchema>;
export type SendPromptRequest = z.infer<typeof SendPromptSchema>;
//# sourceMappingURL=index.d.ts.map