import { z } from 'zod';

import { ProductWorkRunDetailSchema } from './product-projection/index.js';

export const ProductCompletionDecisionRequestSchema = z.discriminatedUnion(
  'decision',
  [
    z
      .object({
        decision: z.literal('approve'),
        control_revision: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        decision: z.literal('reject'),
        control_revision: z.number().int().nonnegative(),
        feedback: z.string().trim().min(1).max(4096),
        work_item_ids: z
          .array(z.uuid())
          .min(1)
          .superRefine((ids, context) => {
            if (new Set(ids).size !== ids.length)
              context.addIssue({
                code: 'custom',
                message: 'work_item_ids must be unique',
              });
          }),
      })
      .strict(),
  ],
);

export const ProductCompletionDecisionResponseSchema = z
  .object({ work_run: ProductWorkRunDetailSchema })
  .strict();
