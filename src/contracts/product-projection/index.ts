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
import { ProductSourceRefsSchema } from '../product-source-refs.js';

// S4 provisional composition; S10 owns acceptance and versioning.
const ExecutionRunSchema = z
  .object({
    status: z.enum([
      'queued',
      'running',
      'succeeded',
      'failed',
      'timed_out',
      'cancelled',
    ]),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    result_capture_status: z.enum(['not_present', 'redacted']),
    error_code: z.string().nullable(),
    source_refs: ProductSourceRefsSchema,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

const ExecutionEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: z.enum(['started', 'output', 'succeeded', 'failed', 'cancelled']),
    payload_capture_status: z.enum(['not_present', 'redacted']),
    source_refs: ProductSourceRefsSchema,
    created_at: z.string().datetime(),
  })
  .strict();

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
    error: z.object({ code: z.string(), message: z.string() }).strict(),
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
  events: z.array(ExecutionEventSchema),
}).strict();

export const ProductRunTraceNullSchema = z
  .object({
    contract_status: z.literal(PRODUCT_CONTRACT_STATUS),
    work: z.null(),
    work_run: z.null(),
    capture_status: z.literal('not_found'),
    runs: z.array(ExecutionRunSchema),
    events: z.array(ExecutionEventSchema),
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
};
