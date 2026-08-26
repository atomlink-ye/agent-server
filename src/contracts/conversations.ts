import { z } from 'zod';

/**
 * Browser-safe Chat/Conversation contract.
 *
 * The Conversation plane previously had no contract module: its browser-facing
 * shape was declared inline inside the BFF entrypoint, so the browser's
 * definition of a Conversation lived beside the routes that served it and could
 * drift from `src/domain/chat/conversation.ts` and from the `conversations` /
 * `chat_messages` tables with nothing to catch it. These schemas are the single
 * canonical statement of that shape, alongside every sibling plane's contract.
 *
 * Identifiers stay `z.string().min(1)` rather than `z.uuid()`: the Conversation
 * plane also carries agent-definition and principal identifiers that are not
 * required to be UUIDs, and tightening them here would change what the BFF
 * accepts from the upstream contract.
 */

export const ConversationKindSchema = z.enum(['direct', 'group']);

export const ConversationDirectAgentSchema = z.object({
  agent_definition_id: z.string().min(1),
  display_name: z.string().nullable(),
});

export const ConversationSchema = z.object({
  conversation_id: z.string().min(1),
  kind: ConversationKindSchema,
  title: z.string().nullable(),
  direct_agent: ConversationDirectAgentSchema.nullable(),
  topic: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const ConversationMessageAuthorTypeSchema = z.enum([
  'principal',
  'agent_definition',
]);

export const ConversationMessageSchema = z.object({
  message_id: z.string().min(1),
  conversation_id: z.string().min(1),
  sequence: z.number().int().positive(),
  author_type: ConversationMessageAuthorTypeSchema,
  author_id: z.string().min(1),
  body: z.string().min(1),
  agent_definition_id: z.string().nullable(),
  agent_version_id: z.string().nullable(),
  runtime_epoch: z.number().int().nullable(),
  work_ref: z.string().nullable(),
  created_at: z.string().min(1),
});

/**
 * The Work card a Conversation renders inline. It belongs to the Chat plane's
 * browser contract because it is only ever reached through a Conversation.
 */
export const ChatWorkCardSchema = z.object({
  workId: z.string().min(1),
  workRef: z.string().min(1),
  title: z.string().min(1),
  productState: z.enum([
    'running',
    'needs_you',
    'complete',
    'problem',
    'not_captured',
  ]),
  problemKind: z.enum(['failed', 'cancelled', 'not_captured']).nullable(),
  attentionReason: z
    .enum(['completion_approval_pending', 'not_captured'])
    .nullable(),
  resultSummary: z.string().nullable(),
  resultCaptureStatus: z.enum([
    'present',
    'not_present',
    'redacted',
    'not_captured',
  ]),
});

export const ConversationListResponseSchema = z.object({
  conversations: z.array(ConversationSchema),
});

export const ConversationReadResponseSchema = z.object({
  conversation: ConversationSchema,
});

export const ConversationMessagesResponseSchema = z.object({
  messages: z.array(ConversationMessageSchema),
});

export const ConversationPostResponseSchema = z.object({
  message: ConversationMessageSchema,
  dispatch_enqueued: z.boolean(),
});

export const CreateConversationRequestSchema = z
  .object({ agent_definition_id: z.string().trim().min(1).max(256) })
  .strict();

export const PostConversationMessageRequestSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1024),
  })
  .strict();

export type ConversationKind = z.infer<typeof ConversationKindSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ChatWorkCard = z.infer<typeof ChatWorkCardSchema>;
export type ConversationListResponse = z.infer<
  typeof ConversationListResponseSchema
>;
export type ConversationReadResponse = z.infer<
  typeof ConversationReadResponseSchema
>;
export type ConversationMessagesResponse = z.infer<
  typeof ConversationMessagesResponseSchema
>;
export type ConversationPostResponse = z.infer<
  typeof ConversationPostResponseSchema
>;
export type CreateConversationRequest = z.infer<
  typeof CreateConversationRequestSchema
>;
export type PostConversationMessageRequest = z.infer<
  typeof PostConversationMessageRequestSchema
>;
