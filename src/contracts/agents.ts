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

export const CreateCoworkerRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(2_000),
    instructions: z.string().trim().min(1).max(16_384).optional(),
    model_policy_ref: z
      .enum([
        'free-only',
        'claude/deepseek-v4-flash',
        'codex/deepseek-v4-flash',
      ])
      .default('free-only'),
    tools: z.array(z.string().trim().min(1).max(256)).max(32).default([]),
    skills: z.array(z.string().trim().min(1).max(256)).max(32).default([]),
  })
  .strict();

export const CreateCoworkerResponseSchema = z
  .object({
    agent_id: AgentIdSchema,
    agent_version_id: AgentIdSchema,
    conversation_id: z.string().min(1).max(256),
  })
  .strict();

const workInputStringSchema = z
  .object({
    type: z.literal('string'),
    min_length: z.number().int().nonnegative().optional(),
    max_length: z.number().int().nonnegative().optional(),
    enum: z.array(z.string()).min(1).max(100).optional(),
  })
  .strict();
const workInputNumberSchema = z
  .object({
    type: z.enum(['number', 'integer']),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
  })
  .strict();
const workInputBooleanSchema = z
  .object({ type: z.literal('boolean') })
  .strict();
const workInputPropertySchema = z.union([
  workInputStringSchema,
  workInputNumberSchema,
  workInputBooleanSchema,
]);
export const AgentWorkCatalogInputSchema = z
  .object({
    type: z.literal('object'),
    properties: z.record(z.string().min(1), workInputPropertySchema),
    required: z.array(z.string().min(1)).max(64),
    additional_properties: z.boolean(),
  })
  .strict();

export const AgentWorkCatalogEntrySchema = z
  .object({
    definition_id: AgentIdSchema,
    definition_version_id: AgentIdSchema,
    name: z.string().min(1).max(200),
    description: z.string().nullable(),
    input_schema: AgentWorkCatalogInputSchema,
  })
  .strict();

export const AssociateAgentCapabilityRequestSchema = z
  .object({
    definition_id: AgentIdSchema,
    definition_version_id: AgentIdSchema,
  })
  .strict();
export const AssociateAgentCapabilityResponseSchema = z
  .object({
    associated: z.literal(true),
    agent_definition_id: AgentIdSchema,
    definition_id: AgentIdSchema,
    definition_version_id: AgentIdSchema,
  })
  .strict();

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
    runtime_status: z.enum([
      'available',
      'draining',
      'unavailable',
      'working',
      'thinking',
    ]),
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
    work_catalog: z.array(AgentWorkCatalogEntrySchema).max(100).default([]),
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
export type AgentWorkCatalogEntry = z.infer<typeof AgentWorkCatalogEntrySchema>;
export type CreateCoworkerRequest = z.infer<typeof CreateCoworkerRequestSchema>;
export type CreateCoworkerResponse = z.infer<
  typeof CreateCoworkerResponseSchema
>;
export type AgentVersionResponse = z.infer<typeof AgentVersionResponseSchema>;
export type AgentVersionListResponse = z.infer<
  typeof AgentVersionListResponseSchema
>;
