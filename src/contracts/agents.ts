import { z } from 'zod';

export const MAX_AGENT_REQUEST_BYTES = 64 * 1024;

export const ValidateAgentPackageRequestSchema = z
  .object({ source: z.string() })
  .strict();
export const ImportAgentRequestSchema = ValidateAgentPackageRequestSchema;
export const PublishAgentVersionRequestSchema = z.object({}).strict();

const compilerSchema = z
  .object({
    pattern_dialect: z.string(),
    pattern_compiler_version: z.string(),
  })
  .strict();
const definitionLinksSchema = z
  .object({ self: z.string(), versions: z.string() })
  .strict();
const versionLinksSchema = z
  .object({ self: z.string(), definition: z.string() })
  .strict();

export const ValidateAgentPackageResponseSchema = z
  .object({
    valid: z.literal(true),
    fingerprint: z.string(),
    metadata: z.object({ normalized_name: z.string() }).strict(),
    compiler: compilerSchema,
  })
  .strict();

export const AgentDefinitionResponseSchema = z
  .object({
    id: z.string(),
    normalized_name: z.string(),
    display_name: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    links: definitionLinksSchema,
  })
  .strict();

export const AgentVersionResponseSchema = z
  .object({
    id: z.string(),
    definition_id: z.string(),
    status: z.enum(['draft', 'published']),
    display_name: z.string(),
    fingerprint: z.string(),
    compiler: compilerSchema,
    created_at: z.string(),
    updated_at: z.string(),
    published_at: z.string().nullable(),
    links: versionLinksSchema,
  })
  .strict();

export const ImportAgentResponseSchema = z
  .object({
    result: z.enum(['created', 'converged', 'replayed']),
    agent: AgentDefinitionResponseSchema,
    version: AgentVersionResponseSchema,
  })
  .strict();

export const AgentVersionListResponseSchema = z
  .object({
    items: z.array(AgentVersionResponseSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

export type ValidateAgentPackageResponse = z.infer<
  typeof ValidateAgentPackageResponseSchema
>;
export type ImportAgentResponse = z.infer<typeof ImportAgentResponseSchema>;
export type AgentDefinitionResponse = z.infer<
  typeof AgentDefinitionResponseSchema
>;
export type AgentVersionResponse = z.infer<typeof AgentVersionResponseSchema>;
export type AgentVersionListResponse = z.infer<
  typeof AgentVersionListResponseSchema
>;
