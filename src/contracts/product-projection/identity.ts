import { z } from 'zod';

import { TeamWorkItemResponseSchema } from '../teams.js';
import { ProductSourceRefsSchema } from '../product-source-refs.js';

const attemptStatuses = ['queued', 'running', 'completed', 'failed'] as const;
const captureStatuses = ['not_present', 'redacted'] as const;

export const ProductAttemptSchema = z
  .object({
    id: z.uuid(),
    attempt_no: z.number().int().positive(),
    status: z.enum(attemptStatuses),
    started_at: z.string().datetime().nullable(),
    ended_at: z.string().datetime().nullable(),
    duration_ms: z.number().int().nonnegative().nullable(),
    timing_capture_status: z.enum(['captured', 'not_captured']),
    feedback_summary: z.string().nullable(),
    feedback_capture_status: z.enum(captureStatuses),
    result_summary: z.string().nullable(),
    result_capture_status: z.enum(captureStatuses),
    source_refs: ProductSourceRefsSchema,
  })
  .strict();

export const ProductWorkItemSchema = z
  .object({
    id: z.uuid(),
    subject: z.string(),
    description: z.string().nullable(),
    status: TeamWorkItemResponseSchema.shape.status,
    actor_id: z.uuid().nullable(),
    dependency_ids: z.array(z.uuid()),
    attempts: z.array(ProductAttemptSchema),
    source_refs: ProductSourceRefsSchema,
  })
  .strict();

export const ProductActorSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    source_refs: ProductSourceRefsSchema,
  })
  .strict();

export const ProductMessageSchema = z
  .object({
    id: z.uuid(),
    sender_id: z.uuid(),
    recipient_id: z.uuid(),
    sender_name: z.string().nullable(),
    recipient_name: z.string().nullable(),
    summary: z.string().nullable(),
    summary_capture_status: z.enum(captureStatuses),
    source_refs: ProductSourceRefsSchema,
  })
  .strict();

export const ProductProjectionIdentitySchema = z
  .object({
    work_items: z.array(ProductWorkItemSchema),
    actors: z.array(ProductActorSchema),
    messages: z.array(ProductMessageSchema),
  })
  .strict();

export type ProductAttempt = z.infer<typeof ProductAttemptSchema>;
export type ProductWorkItem = z.infer<typeof ProductWorkItemSchema>;
export type ProductActor = z.infer<typeof ProductActorSchema>;
export type ProductMessage = z.infer<typeof ProductMessageSchema>;
export type ProductProjectionIdentity = z.infer<
  typeof ProductProjectionIdentitySchema
>;
