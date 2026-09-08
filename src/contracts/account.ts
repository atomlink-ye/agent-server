import { z } from 'zod';

/**
 * Browser-safe identity contract for the caller's own account. Distinct from
 * the Conversation/Coworker contracts because it names the requester, not a
 * Coworker or a message author -- the one place a human principal's own
 * display name is read and written.
 */

export const AccountResponseSchema = z.object({
  principal_id: z.string().min(1),
  principal_type: z.string().min(1),
  display_name: z.string().nullable(),
});

export const SetDisplayNameRequestSchema = z
  .object({
    display_name: z.string().trim().min(1).max(80),
  })
  .strict();

export const SetDisplayNameResponseSchema = z.object({
  display_name: z.string(),
});

export type AccountResponse = z.infer<typeof AccountResponseSchema>;
export type SetDisplayNameRequest = z.infer<typeof SetDisplayNameRequestSchema>;
export type SetDisplayNameResponse = z.infer<
  typeof SetDisplayNameResponseSchema
>;
