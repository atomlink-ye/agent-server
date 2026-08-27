import { z } from 'zod';

/**
 * Browser-safe ContextFS contract.
 *
 * ContextFS was the second core concept with no contract module: its scope
 * vocabulary and its four mutation request shapes were declared inline inside
 * the `/api/v1/context` entrypoint, and the browser facade forwarded request
 * bodies to them without stating the contract at all. These schemas are the
 * single canonical statement, so the entrypoint that serves ContextFS and the
 * facade that fronts it agree by construction rather than by coincidence.
 *
 * A ContextFS file is addressed by scope plus path, never by a provider path:
 * `ContextScopeKindSchema` is the product vocabulary and deliberately excludes
 * `runtime_scratch`, which is an execution-side detail and is not addressable
 * from the browser.
 */

export const ContextScopeKindSchema = z.enum([
  'organization',
  'workspace',
  'agent',
  'agent_user',
  'conversation',
  'work',
]);

/**
 * A ContextFS path. Trimmed and bounded so a path can never be empty and can
 * never become an unbounded key in the entry store.
 */
export const ContextPathSchema = z.string().trim().min(1).max(2048);

/** Promote a conversation file into the agent's per-user scope. */
export const ContextConversationToUserPromotionRequestSchema = z
  .object({
    agent_definition_id: z.string().trim().min(1),
    conversation_id: z.string().uuid(),
    source_path: ContextPathSchema,
    target_path: ContextPathSchema,
  })
  .strict();

/** Admit a conversation file into a Work's scope. */
export const ContextConversationToWorkAdmissionRequestSchema = z
  .object({
    conversation_id: z.string().uuid(),
    work_id: z.string().uuid(),
    source_path: ContextPathSchema,
    target_path: ContextPathSchema,
  })
  .strict();

/** Publish a file produced by a Work back out of that Work's scope. */
export const ContextWorkResultPublicationRequestSchema = z
  .object({
    work_id: z.string().uuid(),
    source_path: ContextPathSchema,
    target_path: ContextPathSchema,
  })
  .strict();

/**
 * Pin an existing file into an agent's own scope. The source scope excludes
 * `organization`: organization files are already visible to every agent, so
 * pinning one would be a copy with no reader.
 */
export const ContextAgentPinRequestSchema = z
  .object({
    agent_definition_id: z.string().trim().min(1),
    source: z
      .object({
        scope: ContextScopeKindSchema.exclude(['organization']),
        agent_definition_id: z.string().optional(),
        conversation_id: z.string().uuid().optional(),
        work_id: z.string().uuid().optional(),
        path: ContextPathSchema,
      })
      .strict(),
    target_path: ContextPathSchema,
  })
  .strict();

export type ContextScopeKind = z.infer<typeof ContextScopeKindSchema>;
export type ContextConversationToUserPromotionRequest = z.infer<
  typeof ContextConversationToUserPromotionRequestSchema
>;
export type ContextConversationToWorkAdmissionRequest = z.infer<
  typeof ContextConversationToWorkAdmissionRequestSchema
>;
export type ContextWorkResultPublicationRequest = z.infer<
  typeof ContextWorkResultPublicationRequestSchema
>;
export type ContextAgentPinRequest = z.infer<
  typeof ContextAgentPinRequestSchema
>;
