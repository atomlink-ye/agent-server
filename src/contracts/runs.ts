import { z } from 'zod';

import { runStatuses } from '../domain/runs/run-status.js';

export const MAX_RUN_REQUEST_BYTES = 64 * 1024;

export const CreateRunRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(MAX_RUN_REQUEST_BYTES),
  })
  .strict();

export const CreateRunResponseSchema = z.object({
  run_id: z.uuid(),
  status: z.literal('queued'),
  links: z.object({ self: z.string().min(1) }),
});

const RuntimeSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  context_window_max_tokens: z.number().int().positive().optional(),
  context_window_used_tokens: z.number().int().nonnegative().optional(),
});

export const GetRunResponseSchema = z.object({
  run_id: z.uuid(),
  status: z.enum(runStatuses),
  runtime: RuntimeSchema.nullable(),
  result: z.object({ text: z.string() }).nullable(),
  usage: UsageSchema.nullable(),
  error: z
    .object({
      code: z.enum(['runtime_execution_failed', 'runtime_timed_out']),
      message: z.string().min(1),
    })
    .nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;
export type GetRunResponse = z.infer<typeof GetRunResponseSchema>;
