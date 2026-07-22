import { z } from 'zod';

export const LivenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
});

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  service: z.string().min(1),
  checks: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(['ready', 'not_ready']),
      detail: z.string().min(1).optional(),
    }),
  ),
});

export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
