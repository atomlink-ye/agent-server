import { z } from 'zod';

import {
  GetWorkResponseSchema,
  WorkRunSummarySchema,
  WorkResponseSchema,
} from '../product-work-commands.js';
import { ErrorResponseSchema } from '../http.js';
import {
  ProductActorSchema,
  ProductAttemptSchema,
  ProductMessageSchema,
  ProductProjectionIdentitySchema,
  ProductWorkItemSchema,
} from './identity.js';
import {
  ExecutionEventSchema,
  ExecutionEventsSchema,
  ExecutionRunSchema,
  ProductTraceEdgesSchema,
  ProductTraceEdgeSchema,
  McpActivitiesSchema,
  TimelineCoverageSchema,
} from './edges.js';
import { ProductStateSchema } from './product-state.js';

export { ProductStateSchema } from './product-state.js';
export type { ProductState } from './product-state.js';

export const ProductWorkRunDetailSchema = WorkRunSummarySchema.extend({
  product_state: ProductStateSchema,
  problem_kind: z.enum(['failed', 'cancelled', 'not_captured']).nullable(),
  attention_reason: z
    .enum(['completion_approval_pending', 'not_captured'])
    .nullable(),
  result_summary: z.string().nullable(),
  result_capture_status: z.enum([
    'present',
    'not_present',
    'redacted',
    'not_captured',
  ]),
  control_revision: z.number().int().nonnegative().nullable(),
  cancel_availability: z.enum(['available', 'not_available', 'not_captured']),
  completion_decision_availability: z.enum([
    'available',
    'not_available',
    'not_captured',
  ]),
}).strict();

const ProductWorkRunBaseSchema = z
  .object({
    work: WorkResponseSchema,
    work_run: ProductWorkRunDetailSchema,
  })
  .merge(ProductProjectionIdentitySchema);

export const ProductWorkRunSuccessSchema = ProductWorkRunBaseSchema.extend({
  projection_status: z.literal('internally_anchored'),
}).strict();

export const ProductWorkRunNullSchema = z
  .object({
    work: z.null(),
    work_run: z.null(),
    projection_status: z.literal('not_found'),
    work_items: z.array(ProductWorkItemSchema),
    actors: z.array(ProductActorSchema),
    messages: z.array(ProductMessageSchema),
  })
  .strict();

export const ProductWorkRunErrorSchema = ErrorResponseSchema;

export const ProductWorkRunResponseSchema = z.union([
  ProductWorkRunSuccessSchema,
  ProductWorkRunNullSchema,
  ProductWorkRunErrorSchema,
]);

export const ProductRunTraceSuccessSchema = ProductWorkRunBaseSchema.extend({
  projection_status: z.literal('internally_anchored'),
  runs: z.array(ExecutionRunSchema),
  events: ExecutionEventsSchema,
  edges: ProductTraceEdgesSchema,
  mcp_activities: McpActivitiesSchema,
  timeline_coverage: TimelineCoverageSchema,
}).strict();

export const ProductRunTraceNullSchema = z
  .object({
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
export const ProductWorkResponseSchema = GetWorkResponseSchema;

export type ProductWorkRunDetail = z.infer<typeof ProductWorkRunDetailSchema>;
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
