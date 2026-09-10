import { z } from 'zod';
import { WorkRunSummarySchema } from './product-work-commands.js';

export const WorkChatMessageSchema = z
  .object({
    id: z.uuid(),
    work_run_id: z.uuid().nullable().optional(),
    sequence: z.number().int().positive(),
    role: z.enum(['user', 'lead', 'system']),
    body: z.string().min(1).max(16_384),
    status: z.enum(['queued', 'processing', 'replied', 'failed']),
    reply_to_message_id: z.uuid().nullable(),
    failure_code: z.string().min(1).nullable(),
    created_at: z.string().datetime(),
  })
  .strict();

export const WorkChatMessagesResponseSchema = z
  .object({
    work_id: z.uuid(),
    work_run_id: z.uuid().nullable().optional(),
    messages: z.array(WorkChatMessageSchema).max(500),
    preparation: z
      .lazy(() => WorkPreparationResponseSchema)
      .nullable()
      .optional(),
  })
  .strict();

export const WorkPreparationResponseSchema = z
  .object({
    id: z.uuid(),
    work_id: z.uuid(),
    revision: z.number().int().positive(),
    status: z.enum(['collecting', 'ready', 'starting', 'started', 'abandoned']),
    definition_version_id: z.uuid(),
    schema_fingerprint: z.string().min(1),
    candidate_input: z.record(z.string(), z.unknown()),
    confirmed_fingerprint: z.string().nullable(),
    start_intent: z.string().nullable(),
    work_run_id: z.uuid().nullable(),
    missing: z.array(z.string()),
    ambiguities: z.array(z.string()),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

// The URL selects preparation or Run scope; body fields cannot override it.
export const PostWorkChatMessageRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(16_384),
    client_request_id: z.string().trim().min(1).max(200),
  })
  .strict();

export const PostWorkChatMessageResponseSchema = z
  .object({
    message: WorkChatMessageSchema,
    replayed: z.boolean(),
  })
  .strict();

export const RetryWorkChatMessageResponseSchema = z
  .object({ message: WorkChatMessageSchema })
  .strict();

export const ConfirmWorkPreparationRequestSchema = z
  .object({
    preparation_id: z.uuid(),
    expected_revision: z.number().int().positive(),
    client_request_id: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const ConfirmWorkPreparationResponseSchema = z
  .object({
    preparation: WorkPreparationResponseSchema,
    work_run: WorkRunSummarySchema.nullable(),
    reused: z.boolean(),
  })
  .strict();

export type WorkChatMessageResponse = z.infer<typeof WorkChatMessageSchema>;
export type WorkChatMessagesResponse = z.infer<
  typeof WorkChatMessagesResponseSchema
>;
export type PostWorkChatMessageRequest = z.infer<
  typeof PostWorkChatMessageRequestSchema
>;
export type PostWorkChatMessageResponse = z.infer<
  typeof PostWorkChatMessageResponseSchema
>;
export type WorkPreparationResponse = z.infer<
  typeof WorkPreparationResponseSchema
>;
