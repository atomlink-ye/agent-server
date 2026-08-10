import { z } from 'zod';

/** Technical identity is deliberately confined to this fixed audit structure. */
export const PRODUCT_SOURCE_REF_KEYS = [
  'root_task_id',
  'team_run_id',
  'team_member_run_id',
  'task_id',
  'run_id',
  'team_message_id',
] as const;

export const ProductSourceRefsSchema = z
  .object({
    root_task_id: z.uuid().optional(),
    team_run_id: z.uuid().optional(),
    team_member_run_id: z.uuid().optional(),
    task_id: z.uuid().optional(),
    run_id: z.uuid().optional(),
    team_message_id: z.uuid().optional(),
  })
  .strict();

export type ProductSourceRefs = z.infer<typeof ProductSourceRefsSchema>;
