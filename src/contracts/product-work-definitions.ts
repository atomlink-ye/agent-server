import { z } from 'zod';

export const WorkDefinitionDiagnosticSchema = z
  .object({
    path: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    severity: z.literal('error'),
  })
  .strict();

export const WorkDefinitionSourceRequestSchema = z
  .object({
    source: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict();

export const WorkDefinitionValidateSuccessSchema = z
  .object({
    valid: z.literal(true),
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    metadata: z.object({ normalized_name: z.string().min(1) }).strict(),
    diagnostics: z.tuple([]),
  })
  .strict();

export const WorkDefinitionValidateFailureSchema = z
  .object({
    valid: z.literal(false),
    diagnostics: z.array(WorkDefinitionDiagnosticSchema).min(1),
  })
  .strict();

export const WorkDefinitionParticipantPlanSchema = z
  .object({
    name: z.string().min(1),
    role: z.enum(['primary', 'lead', 'member']),
    source: z.enum(['referenced', 'inline']),
    worker_version_id: z.uuid().nullable(),
    skills: z.array(z.string()),
    tools: z.array(z.string()),
  })
  .strict();

export const WorkDefinitionPlanResponseSchema = z
  .object({
    valid: z.literal(true),
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    metadata: z.object({ normalized_name: z.string().min(1) }).strict(),
    resolved: z
      .object({
        kind: z.enum(['single_worker', 'collaboration']),
        participants: z.array(WorkDefinitionParticipantPlanSchema).min(1),
        environment: z
          .object({
            source: z.enum(['referenced', 'inline']),
            environment_version_id: z.uuid().nullable(),
          })
          .strict(),
        memory_version_ids: z.array(z.uuid()),
        required_runtime_capabilities: z.array(z.string()),
        platform_capabilities: z.array(z.string()),
        materialization: z
          .object({
            inline_workers: z.number().int().nonnegative(),
            inline_environment: z.boolean(),
            internal_team: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    diagnostics: z.tuple([]),
  })
  .strict();

export const ProductWorkDefinitionVersionSchema = z
  .object({
    id: z.uuid(),
    definition_id: z.uuid(),
    status: z.literal('published'),
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    source: z.record(z.string(), z.unknown()),
    source_yaml: z
      .string()
      .min(1)
      .max(64 * 1024),
    resolved: z
      .object({
        resource_manifest_fingerprint: z
          .string()
          .regex(/^sha256:[0-9a-f]{64}$/)
          .nullable(),
      })
      .strict(),
    created_at: z.string().datetime(),
    published_at: z.string().datetime(),
    links: z
      .object({
        self: z.string(),
        definition: z.string(),
      })
      .strict(),
  })
  .strict();

export const ProductWorkDefinitionSchema = z
  .object({
    id: z.uuid(),
    normalized_name: z.string().min(1),
    description: z.string().nullable(),
    created_at: z.string().datetime(),
    latest_version_id: z.uuid().nullable(),
    links: z
      .object({
        self: z.string(),
        versions: z.string(),
      })
      .strict(),
  })
  .strict();

export const WorkDefinitionApplyResponseSchema = z
  .object({
    result: z.enum(['created', 'converged', 'replayed']),
    definition: ProductWorkDefinitionSchema,
    version: ProductWorkDefinitionVersionSchema,
    resolved: z
      .object({
        resource_manifest_fingerprint: z
          .string()
          .regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();

export const GetProductWorkDefinitionResponseSchema = z
  .object({
    definition: ProductWorkDefinitionSchema,
    latest_version: ProductWorkDefinitionVersionSchema.nullable(),
  })
  .strict();

// Selector reads intentionally expose only display-safe metadata and the
// canonical published version identity needed to create/promote Product Work.
export const ProductWorkDefinitionSelectorItemSchema = z
  .object({
    definition_id: z.uuid(),
    display_name: z.string().min(1),
    current_published_version_id: z.uuid(),
  })
  .strict();

export const ListProductWorkDefinitionsResponseSchema = z
  .object({
    items: z.array(ProductWorkDefinitionSelectorItemSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

// List responses omit the full source payload; single-version reads include it.
export const ProductWorkDefinitionVersionSummarySchema =
  ProductWorkDefinitionVersionSchema.omit({ source: true });
export type ProductWorkDefinitionVersionSummaryResponse = z.infer<
  typeof ProductWorkDefinitionVersionSummarySchema
>;

export const ListProductWorkDefinitionVersionsResponseSchema = z
  .object({
    versions: z.array(ProductWorkDefinitionVersionSummarySchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

export const GetProductWorkDefinitionVersionResponseSchema = z
  .object({ version: ProductWorkDefinitionVersionSchema })
  .strict();

export type ProductWorkDefinitionResponse = z.infer<
  typeof ProductWorkDefinitionSchema
>;
export type ProductWorkDefinitionVersionResponse = z.infer<
  typeof ProductWorkDefinitionVersionSchema
>;
export type ProductWorkDefinitionSelectorItem = z.infer<
  typeof ProductWorkDefinitionSelectorItemSchema
>;
export type ListProductWorkDefinitionsResponse = z.infer<
  typeof ListProductWorkDefinitionsResponseSchema
>;
