import { z } from 'zod';
export const MAX_LEARNING_PROPOSAL_ACTION_BYTES = 16 * 1024;
const sha = z.string().regex(/^[0-9a-f]{64}$/);
export const LearningProposalResponseSchema = z.object({
  learning_proposal_id: z.uuid(),
  workspace_id: z.uuid(),
  source: z.object({
    team_run_id: z.uuid(),
    task_id: z.uuid(),
    run_id: z.uuid(),
  }),
  target: z.object({
    memory_store_id: z.uuid(),
    memory_id: z.uuid(),
    path: z.string(),
    base_content_sha256: sha,
  }),
  proposed_content: z.string().min(1),
  evidence_refs: z.array(z.string()).min(1).max(8),
  status: z.enum(['pending', 'accepted', 'rejected']),
  accepted_memory_version_id: z.uuid().nullable(),
  reviewed_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export const EditAndAcceptLearningProposalRequestSchema = z
  .object({ content: z.string().min(1) })
  .strict();
export type LearningProposalResponse = z.infer<
  typeof LearningProposalResponseSchema
>;
