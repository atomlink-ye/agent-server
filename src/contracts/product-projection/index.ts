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
} from './edges.js';

const ProductWorkRunBaseSchema = z
  .object({
    contract_status: z.literal(PRODUCT_CONTRACT_STATUS),
    work: WorkResponseSchema,
    work_run: WorkRunResponseSchema,
  })
  .merge(ProductProjectionIdentitySchema);

export const ProductWorkRunSuccessSchema = ProductWorkRunBaseSchema.extend({
  capture_status: z.literal('complete'),
}).strict();

export const ProductWorkRunNullSchema = z
  .object({
    contract_status: z.literal(PRODUCT_CONTRACT_STATUS),
    work: z.null(),
    work_run: z.null(),
    capture_status: z.literal('not_found'),
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
  capture_status: z.literal('complete'),
  runs: z.array(ExecutionRunSchema),
  events: ExecutionEventsSchema,
  edges: ProductTraceEdgesSchema,
}).strict();

export const ProductRunTraceNullSchema = z
  .object({
    contract_status: z.literal(PRODUCT_CONTRACT_STATUS),
    work: z.null(),
    work_run: z.null(),
    capture_status: z.literal('not_found'),
    runs: z.array(ExecutionRunSchema),
    events: ExecutionEventsSchema,
    edges: ProductTraceEdgesSchema,
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
  ProductTraceEdgeSchema,
  ProductTraceEdgesSchema,
};
