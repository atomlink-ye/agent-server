import { z } from 'zod';

const LogicalRef = z.string().regex(/^[WM]-\d+$/);
const BoardStatus = z.enum([
  'open',
  'assigned',
  'in_progress',
  'blocked',
  'submitted',
  'accepted',
  'cancelled',
]);

export const CollaborationRunResponseSchema = z
  .object({
    collaboration_run_id: z.uuid(),
    status: z.string(),
    participants: z.array(
      z
        .object({
          name: z.string(),
          role: z.enum(['lead', 'member']),
          status: z.string(),
        })
        .strict(),
    ),
    board: z.array(
      z
        .object({
          work_ref: z.string().regex(/^W-\d+$/),
          subject: z.string(),
          description: z.string().nullable(),
          status: BoardStatus,
          owner: z.string().nullable(),
          dependency_refs: z.array(z.string().regex(/^W-\d+$/)),
          latest_attempt_no: z.number().int().positive().nullable(),
          latest_checkpoint: z
            .object({
              summary: z.string(),
              next_step: z.string().nullable(),
              blocker: z.string().nullable(),
              evidence_refs: z.array(z.string()),
              created_at: z.string(),
            })
            .strict()
            .nullable(),
          latest_submission: z
            .object({
              attempt_no: z.number().int().positive(),
              summary: z.string(),
              evidence_refs: z.array(z.string()),
              artifact_refs: z.array(z.string()),
              created_at: z.string(),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
    mailbox: z.array(
      z
        .object({
          message_ref: z.string().regex(/^M-\d+$/),
          from: z.string(),
          to: z.string(),
          body: z.string(),
          about_work_ref: z.string().regex(/^W-\d+$/).nullable(),
          reply_to_ref: z.string().regex(/^M-\d+$/).nullable(),
          priority: z.enum(['normal', 'urgent']),
          requires_ack: z.boolean(),
          status: z.enum([
            'pending',
            'presented',
            'acknowledged',
            'cancelled',
          ]),
          created_at: z.string(),
          acknowledged_at: z.string().nullable(),
        })
        .strict(),
    ),
    checkpoints: z.array(
      z
        .object({
          checkpoint_id: z.uuid(),
          work_ref: z.string().regex(/^W-\d+$/).nullable(),
          participant: z.string(),
          summary: z.string(),
          next_step: z.string().nullable(),
          blocker: z.string().nullable(),
          evidence_refs: z.array(z.string()),
          created_at: z.string(),
        })
        .strict(),
    ),
    submissions: z.array(
      z
        .object({
          submission_id: z.uuid(),
          work_ref: z.string().regex(/^W-\d+$/).nullable(),
          attempt_no: z.number().int().positive(),
          participant: z.string(),
          summary: z.string(),
          evidence_refs: z.array(z.string()),
          artifact_refs: z.array(z.string()),
          created_at: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type CollaborationRunResponse = z.infer<
  typeof CollaborationRunResponseSchema
>;

void LogicalRef;
