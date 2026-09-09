import { z } from 'zod';

export const WorkChatMessageSchema = z
  .object({
    id: z.uuid(),
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
    messages: z.array(WorkChatMessageSchema).max(500),
  })
  .strict();

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
