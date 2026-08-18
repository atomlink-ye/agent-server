import { z } from 'zod';

export const GetProductExecutionDetailRequestSchema = z
  .object({
    work_id: z.uuid(),
    work_run_id: z.uuid(),
    attempt_id: z.uuid(),
  })
  .strict();

const DetailEventBaseSchema = z
  .object({
    sequence: z.number().int().positive(),
    created_at: z.string().datetime(),
  })
  .strict();

export const ProductExecutionLifecycleEventSchema = DetailEventBaseSchema.extend({
  kind: z.literal('lifecycle'),
  status: z.string().min(1).max(64),
  /** Provider/run-event discriminator retained for unknown lifecycle kinds. */
  raw_type: z.string().min(1).max(128).optional(),
}).strict();

export const ProductExecutionAssistantTextEventSchema = DetailEventBaseSchema.extend({
  kind: z.literal('assistant_text'),
  text: z.string().max(32_000),
}).strict();

export const ProductExecutionReasoningEventSchema = DetailEventBaseSchema.extend({
  kind: z.literal('reasoning_progress'),
  status: z.enum(['started', 'completed']),
  text: z.string().max(32_000).nullable(),
}).strict();

const toolCategories = [
  'shell',
  'read',
  'edit',
  'write',
  'search',
  'fetch',
  'subagent',
  'other',
] as const;
const toolStatuses = ['running', 'completed', 'failed', 'cancelled'] as const;
const detailKinds = ['shell', 'read', 'write', 'edit', 'search', 'fetch'] as const;

export const ProductExecutionToolEventSchema = DetailEventBaseSchema.extend({
  kind: z.literal('tool_status'),
  activity_id: z.string().min(1).max(256),
  category: z.enum(toolCategories),
  status: z.enum(toolStatuses),
  label: z.string().max(120).nullable(),
  summary: z.string().max(2_000).nullable(),
  provider: z.string().max(64).nullable(),
  tool_name: z.string().max(256).nullable(),
  detail_kind: z.enum(detailKinds).nullable(),
  detail_text: z.string().max(12_000).nullable(),
  exit_code: z.number().int().nullable(),
  parent_activity_id: z.string().max(256).nullable(),
}).strict();

export const ProductExecutionChildActivityEventSchema = DetailEventBaseSchema.extend({
  kind: z.literal('child_timeline_item'),
  activity_id: z.string().min(1).max(256),
  parent_activity_id: z.string().min(1).max(256),
  item_kind: z.enum(['assistant', 'reasoning', 'tool']),
  status: z.enum(toolStatuses),
  label: z.string().max(120),
  summary: z.string().max(2_000),
  provider: z.string().max(64).nullable(),
  detail_kind: z.enum(detailKinds).nullable(),
  detail_text: z.string().max(12_000).nullable(),
  exit_code: z.number().int().nullable(),
}).strict();

export const ProductExecutionPermissionEventSchema = DetailEventBaseSchema.extend({
  kind: z.literal('permission'),
  activity_id: z.string().min(1).max(256),
  category: z.enum(['tool', 'plan', 'question', 'mode', 'other']),
  status: z.enum(['requested', 'resolved']),
  decision: z.enum(['allowed', 'denied']).nullable(),
  summary: z.string().max(2_000),
}).strict();

export const ProductExecutionUsageEventSchema = DetailEventBaseSchema.extend({
  kind: z.literal('usage'),
  input_tokens: z.number().finite().nonnegative().nullable(),
  cached_input_tokens: z.number().finite().nonnegative().nullable(),
  output_tokens: z.number().finite().nonnegative().nullable(),
  total_cost_usd: z.number().finite().nonnegative().nullable(),
  context_window_max_tokens: z.number().finite().nonnegative().nullable(),
  context_window_used_tokens: z.number().finite().nonnegative().nullable(),
}).strict();

export const ProductExecutionDetailEventSchema = z.discriminatedUnion('kind', [
  ProductExecutionLifecycleEventSchema,
  ProductExecutionAssistantTextEventSchema,
  ProductExecutionReasoningEventSchema,
  ProductExecutionToolEventSchema,
  ProductExecutionChildActivityEventSchema,
  ProductExecutionPermissionEventSchema,
  ProductExecutionUsageEventSchema,
]);

export const ProductExecutionDetailResponseSchema = z
  .object({
    work_id: z.uuid(),
    work_run_id: z.uuid(),
    work_item_id: z.uuid(),
    attempt_id: z.uuid(),
    actor_id: z.uuid().nullable(),
    capture_scope: z.literal('safe_run_events'),
    truncated: z.boolean(),
    events: z.array(ProductExecutionDetailEventSchema).max(2_000),
  })
  .strict();

export type GetProductExecutionDetailRequest = z.infer<
  typeof GetProductExecutionDetailRequestSchema
>;
export type ProductExecutionDetailEvent = z.infer<
  typeof ProductExecutionDetailEventSchema
>;
export type ProductExecutionDetailResponse = z.infer<
  typeof ProductExecutionDetailResponseSchema
>;
