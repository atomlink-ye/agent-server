import { z } from 'zod';

import { ProductExecutionDetailEventSchema } from './execution-detail.js';
import { ProductSourceRefsSchema } from '../product-source-refs.js';

export const GetProductSessionTranscriptsRequestSchema = z
  .object({
    work_id: z.uuid(),
    work_run_id: z.uuid(),
  })
  .strict();

const ProductSessionTranscriptLabelSchema = z
  .object({
    name: z.string().min(1).max(256),
    // Team membership is optional extra structure, not a precondition for a
    // stream to exist: a lone agent (no Team) has no role.
    role: z.string().min(1).max(64).nullable(),
    status: z.string().min(1).max(64),
    status_basis: z.enum(['team_member_run', 'agent_runs']),
    source_refs: ProductSourceRefsSchema,
  })
  .strict();

const ProductSessionTranscriptMeaningfulSchema = z
  .object({
    kind: z.string().min(1).max(64),
    timestamp: z.string().datetime(),
    action: z.string().max(2_000).nullable(),
    result: z.string().max(12_000).nullable(),
  })
  .strict();

const ProductSessionTranscriptSummarySchema = z
  .object({
    status: z.string().min(1).max(64),
    entry_count: z.number().int().nonnegative(),
    last_timestamp: z.string().datetime().nullable(),
    last_meaningful: ProductSessionTranscriptMeaningfulSchema.nullable(),
    work_refs: z.array(z.string().regex(/^W-[1-9]\d*$/u)).max(256),
    truncated: z.boolean(),
  })
  .strict();

const ProductSessionTranscriptEntrySchema = z
  .object({
    ordinal: z.number().int().positive(),
  })
  .and(ProductExecutionDetailEventSchema);

export const ProductSessionTranscriptSchema = z
  .object({
    label: ProductSessionTranscriptLabelSchema,
    summary: ProductSessionTranscriptSummarySchema,
    entries: z.array(ProductSessionTranscriptEntrySchema).max(2_000),
  })
  .strict();

export const ProductSessionTranscriptsResponseSchema = z
  .object({
    work_id: z.uuid(),
    work_run_id: z.uuid(),
    capture_scope: z.literal('safe_run_events'),
    sessions: z.array(ProductSessionTranscriptSchema),
  })
  .strict();

export type GetProductSessionTranscriptsRequest = z.infer<
  typeof GetProductSessionTranscriptsRequestSchema
>;
export type ProductSessionTranscript = z.infer<
  typeof ProductSessionTranscriptSchema
>;
export type ProductSessionTranscriptsResponse = z.infer<
  typeof ProductSessionTranscriptsResponseSchema
>;
