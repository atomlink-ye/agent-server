import { z } from 'zod';

/**
 * Browser-safe read-only Whisper contract. There is deliberately no
 * request schema for posting a message: humans peek, they never write.
 */

export const WhisperOriginSchema = z.object({
  conversation_id: z.string().nullable(),
  trigger_message_id: z.string().nullable(),
  work_ref: z.string().nullable(),
});

export const WhisperChannelSchema = z.object({
  whisper_channel_id: z.string().min(1),
  topic: z.string().nullable(),
  members: z.array(z.string().min(1)),
  initiated_by: z.string().min(1),
  origin: WhisperOriginSchema,
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const WhisperMessageSchema = z.object({
  message_id: z.string().min(1),
  whisper_channel_id: z.string().min(1),
  sequence: z.number().int().positive(),
  author_agent_id: z.string().min(1),
  body: z.string().min(1),
  created_at: z.string().min(1),
});

export const WhisperListResponseSchema = z.object({
  whispers: z.array(WhisperChannelSchema),
});

export const WhisperReadResponseSchema = z.object({
  whisper: WhisperChannelSchema,
});

export const WhisperMessagesResponseSchema = z.object({
  messages: z.array(WhisperMessageSchema),
});

export type WhisperChannelResponse = z.infer<typeof WhisperChannelSchema>;
export type WhisperMessageResponse = z.infer<typeof WhisperMessageSchema>;
export type WhisperListResponse = z.infer<typeof WhisperListResponseSchema>;
export type WhisperReadResponse = z.infer<typeof WhisperReadResponseSchema>;
export type WhisperMessagesResponse = z.infer<
  typeof WhisperMessagesResponseSchema
>;
