import { z } from 'zod';

export const MAX_WORKSPACE_MEMORY_REQUEST_BYTES = 64 * 1024;

export const CreateMemoryProposalRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(MAX_WORKSPACE_MEMORY_REQUEST_BYTES),
    category: z.string().trim().min(1).max(256),
    source_task_id: z.uuid().optional(),
    source_session_id: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const MemoryProposalResponseSchema = z.object({
  proposal_id: z.uuid(),
  content: z.string().min(1),
  category: z.string().min(1),
  source_task_id: z.uuid().nullable(),
  source_session_id: z.string().min(1).nullable(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  review_outcome: z.enum(['accept', 'edit_and_accept', 'reject']).nullable(),
  reviewed_content: z.string().min(1).nullable(),
  reviewed_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const CreateMemoryProposalResponseSchema = z.object({
  proposal: MemoryProposalResponseSchema,
  links: z.object({ self: z.string().min(1) }),
});

export const ListMemoryProposalsResponseSchema = z.object({
  proposals: z.array(MemoryProposalResponseSchema),
});

export const ReviewMemoryProposalRequestSchema = z.discriminatedUnion(
  'action',
  [
    z.object({ action: z.literal('accept') }).strict(),
    z
      .object({
        action: z.literal('edit_and_accept'),
        content: z
          .string()
          .trim()
          .min(1)
          .max(MAX_WORKSPACE_MEMORY_REQUEST_BYTES),
      })
      .strict(),
    z.object({ action: z.literal('reject') }).strict(),
  ],
);

export const WorkspaceMemoryEntryResponseSchema = z.object({
  entry_id: z.uuid(),
  proposal_id: z.uuid(),
  content: z.string().min(1),
  category: z.string().min(1),
  source_task_id: z.uuid().nullable(),
  source_session_id: z.string().min(1).nullable(),
  review_outcome: z.enum(['accept', 'edit_and_accept']),
  accepted_at: z.iso.datetime(),
});

export const ReviewMemoryProposalResponseSchema = z.object({
  proposal: MemoryProposalResponseSchema,
  entry: WorkspaceMemoryEntryResponseSchema.nullable(),
});

export const ListMemoryEntriesResponseSchema = z.object({
  entries: z.array(WorkspaceMemoryEntryResponseSchema),
});

export type CreateMemoryProposalRequest = z.infer<
  typeof CreateMemoryProposalRequestSchema
>;
export type MemoryProposalResponse = z.infer<
  typeof MemoryProposalResponseSchema
>;
export type CreateMemoryProposalResponse = z.infer<
  typeof CreateMemoryProposalResponseSchema
>;
export type ListMemoryProposalsResponse = z.infer<
  typeof ListMemoryProposalsResponseSchema
>;
export type ReviewMemoryProposalRequest = z.infer<
  typeof ReviewMemoryProposalRequestSchema
>;
export type WorkspaceMemoryEntryResponse = z.infer<
  typeof WorkspaceMemoryEntryResponseSchema
>;
export type ReviewMemoryProposalResponse = z.infer<
  typeof ReviewMemoryProposalResponseSchema
>;
export type ListMemoryEntriesResponse = z.infer<
  typeof ListMemoryEntriesResponseSchema
>;
