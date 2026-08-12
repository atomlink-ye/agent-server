import { z } from 'zod';

import { PRODUCT_CONTRACT_STATUS } from '../product-contract-policy.js';
import {
  ProductProjectionIdentitySchema,
  ProductActorSchema,
  ProductAttemptSchema,
  ProductMessageSchema,
  ProductWorkItemSchema,
} from './identity.js';
import {
  WorkResponseSchema,
  WorkRunResponseSchema,
} from '../product-work-commands.js';
import {
  ExecutionEventSchema,
  ExecutionEventsSchema,
  ExecutionRunSchema,
  ProductTraceEdgesSchema,
  ProductTraceEdgeSchema,
  McpActivitiesSchema,
  TimelineCoverageSchema,
} from './edges.js';

const ProductWorkRunBaseSchema = z
  .object({
    contract_status: z.literal(PRODUCT_CONTRACT_STATUS),
    work: WorkResponseSchema,
    work_run: WorkRunResponseSchema,
  })
  .merge(ProductProjectionIdentitySchema);

const ProductProjectionFollowUpReadSchema = z
  .object({
    id: z.string().min(1),
    resource: z.string().min(1),
    missing_fields: z.array(z.string().min(1)).min(1),
    method: z.literal('GET'),
    path: z.string().min(1),
    source_ref: z
      .object({
        root_task_id: z.string().min(1).optional(),
        team_run_id: z.string().min(1).optional(),
      })
      .strict()
      .refine(
        (value) =>
          (value.root_task_id !== undefined) !==
          (value.team_run_id !== undefined),
        'follow_up_read_source_ref_must_have_one_id',
      ),
  })
  .strict();

export const ProductProjectionFollowUpReadsSchema = z
  .array(ProductProjectionFollowUpReadSchema)
  .length(2);

export const ProductWorkRunSuccessSchema = ProductWorkRunBaseSchema.extend({
  projection_status: z.literal('internally_anchored'),
  follow_up_reads: ProductProjectionFollowUpReadsSchema,
}).strict();

export const ProductWorkRunNullSchema = z
  .object({
    contract_status: z.literal(PRODUCT_CONTRACT_STATUS),
    work: z.null(),
    work_run: z.null(),
    projection_status: z.literal('not_found'),
    work_items: z.array(ProductWorkItemSchema),
    actors: z.array(ProductActorSchema),
    messages: z.array(ProductMessageSchema),
  })
  .strict();

export const ProductWorkRunErrorSchema = z
  .object({
    contract_status: z.literal(PRODUCT_CONTRACT_STATUS),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        reason: z
          .enum(['event_page_limit', 'event_page_order_invalid'])
          .optional(),
      })
      .strict(),
  })
  .strict();

export const ProductWorkRunResponseSchema = z.union([
  ProductWorkRunSuccessSchema,
  ProductWorkRunNullSchema,
  ProductWorkRunErrorSchema,
]);

export const ProductRunTraceSuccessSchema = ProductWorkRunBaseSchema.extend({
  projection_status: z.literal('internally_anchored'),
  follow_up_reads: ProductProjectionFollowUpReadsSchema,
  runs: z.array(ExecutionRunSchema),
  events: ExecutionEventsSchema,
  edges: ProductTraceEdgesSchema,
  mcp_activities: McpActivitiesSchema,
  timeline_coverage: TimelineCoverageSchema,
}).strict();

export const ProductRunTraceNullSchema = z
  .object({
    contract_status: z.literal(PRODUCT_CONTRACT_STATUS),
    work: z.null(),
    work_run: z.null(),
    projection_status: z.literal('not_found'),
    runs: z.array(ExecutionRunSchema),
    events: ExecutionEventsSchema,
    edges: ProductTraceEdgesSchema,
    mcp_activities: McpActivitiesSchema,
    timeline_coverage: TimelineCoverageSchema,
  })
  .strict();

export const ProductRunTraceErrorSchema = ProductWorkRunErrorSchema;
export const ProductRunTraceResponseSchema = z.union([
  ProductRunTraceSuccessSchema,
  ProductRunTraceNullSchema,
  ProductRunTraceErrorSchema,
]);

export const ProductWorkRunSchema = ProductWorkRunResponseSchema;
export const ProductRunTraceSchema = ProductRunTraceResponseSchema;

export type ProductWorkRun = z.infer<typeof ProductWorkRunResponseSchema>;
export type ProductRunTrace = z.infer<typeof ProductRunTraceResponseSchema>;

export {
  ProductActorSchema,
  ProductAttemptSchema,
  ProductMessageSchema,
  ProductProjectionIdentitySchema,
  ProductWorkItemSchema,
  ExecutionEventSchema,
  ExecutionEventsSchema,
  ExecutionRunSchema,
  McpActivitiesSchema,
  TimelineCoverageSchema,
  ProductTraceEdgeSchema,
  ProductTraceEdgesSchema,
};
