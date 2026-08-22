import { z } from 'zod';

export const MAX_AGENT_REQUEST_BYTES = 64 * 1024;
const uuidPattern =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const AgentIdSchema = z.string().regex(new RegExp(`^${uuidPattern}$`));
const timestampSchema = z.iso.datetime({ offset: true });
const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const compilerSchema = z
  .object({
    pattern_dialect: z.literal('re2'),
    pattern_compiler_version: z.literal('re2js-2.8.6'),
  })
  .strict();
const definitionSelfLinkSchema = z
  .string()
  .regex(new RegExp(`^/api/v1/agents/${uuidPattern}$`));
const definitionVersionsLinkSchema = z
  .string()
  .regex(new RegExp(`^/api/v1/agents/${uuidPattern}/versions$`));
const versionSelfLinkSchema = z
  .string()
  .regex(new RegExp(`^/api/v1/agent-versions/${uuidPattern}$`));

export const ValidateAgentPackageRequestSchema = z
  .object({ source: z.string() })
  .strict();
export const ImportAgentRequestSchema = ValidateAgentPackageRequestSchema;
export const PublishAgentVersionRequestSchema = z.object({}).strict();

const definitionLinksSchema = z
  .object({
    self: definitionSelfLinkSchema,
    versions: definitionVersionsLinkSchema,
  })
  .strict();
const versionLinksSchema = z
  .object({
    self: versionSelfLinkSchema,
    definition: definitionSelfLinkSchema,
  })
  .strict();

export const ValidateAgentPackageResponseSchema = z
  .object({
    valid: z.literal(true),
    fingerprint: fingerprintSchema,
    metadata: z.object({ normalized_name: z.string().min(1) }).strict(),
    compiler: compilerSchema,
  })
  .strict();

export const AgentDefinitionResponseSchema = z
  .object({
    id: AgentIdSchema,
    normalized_name: z.string().min(1),
    display_name: z.string().min(1),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    role_label: z.string().nullable(),
    summary: z.string().nullable(),
    links: definitionLinksSchema,
  })
  .strict();

export const AgentCoworkerResponseSchema = AgentDefinitionResponseSchema.extend(
  {
    active_agent_version_id: AgentIdSchema,
    runtime_status: z.enum(['available', 'draining', 'unavailable']),
  },
).strict();

export const AgentCoworkerListResponseSchema = z
  .object({
    items: z.array(AgentCoworkerResponseSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

export const AgentCoworkerProfileResponseSchema = z
  .object({
    agent: AgentCoworkerResponseSchema,
    capabilities: z
      .object({
        model_policy_ref: z.string().min(1),
        proposal_limit: z.number().int().nonnegative().nullable(),
        tools: z.array(z.string().min(1)).max(32),
        skills: z.array(z.string().min(1)).max(32),
      })
      .strict(),
  })
  .strict();

export const AgentVersionResponseSchema = z
  .object({
    id: AgentIdSchema,
    definition_id: AgentIdSchema,
    status: z.enum(['draft', 'published']),
    display_name: z.string().min(1),
    fingerprint: fingerprintSchema,
    compiler: compilerSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
    published_at: timestampSchema.nullable(),
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
export type AgentCoworkerResponse = z.infer<typeof AgentCoworkerResponseSchema>;
export type AgentCoworkerListResponse = z.infer<
  typeof AgentCoworkerListResponseSchema
>;
export type AgentCoworkerProfileResponse = z.infer<
  typeof AgentCoworkerProfileResponseSchema
>;
export type AgentVersionResponse = z.infer<typeof AgentVersionResponseSchema>;
export type AgentVersionListResponse = z.infer<
  typeof AgentVersionListResponseSchema
>;
