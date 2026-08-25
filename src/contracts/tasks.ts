import { z } from 'zod';

import { runStatuses } from '../domain/runs/run-status.js';
import { taskStatuses } from '../domain/tasks/task-status.js';

export const MAX_TASK_REQUEST_BYTES = 64 * 1024;

export const CancelTaskResponseSchema = z.object({
  task_id: z.uuid(),
  run_id: z.uuid(),
  status: z.enum(['cancellation_requested', 'cancelled', 'terminal']),
});

export const TaskInvokableSchema = z
  .object({
    kind: z.enum(['agent', 'worker', 'team']),
    version_id: z.uuid(),
  })
  .strict();

export const InvokeTaskRequestSchema = z
  .object({
    invokable: TaskInvokableSchema,
    input: z
      .object({
        text: z.string().trim().min(1).max(MAX_TASK_REQUEST_BYTES),
      })
      .strict(),
    workspace_id: z.string().trim().min(1).optional(),
  })
  .strict();

const TaskLinksSchema = z.object({
  self: z.string().min(1),
  tree: z.string().min(1),
});

export const InvokeTaskResponseSchema = z.object({
  task_id: z.uuid(),
  status: z.literal('queued'),
  links: TaskLinksSchema,
});

export const TaskLatestRunSummarySchema = z.object({
  run_id: z.uuid(),
  attempt: z.number().int().positive(),
  status: z.enum(runStatuses),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const TaskResultSchema = z.object({
  text: z.string(),
});

export const TaskErrorSchema = z.object({
  code: z.enum(['runtime_execution_failed', 'runtime_timed_out', 'cancelled']),
  message: z.string().min(1),
});

export const GetTaskResponseSchema = z.object({
  task_id: z.uuid(),
  status: z.enum(taskStatuses),
  invokable: TaskInvokableSchema,
  root_task_id: z.uuid(),
  parent_task_id: z.uuid().nullable(),
  parent_run_id: z.uuid().nullable(),
  latest_run: TaskLatestRunSummarySchema.nullable(),
  result: TaskResultSchema.nullable(),
  error: TaskErrorSchema.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const GetTaskTreeResponseSchema = z.object({
  root_task_id: z.uuid(),
  tasks: z.array(GetTaskResponseSchema),
});

export type InvokeTaskRequest = z.infer<typeof InvokeTaskRequestSchema>;
export type InvokeTaskResponse = z.infer<typeof InvokeTaskResponseSchema>;
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>;
export type GetTaskTreeResponse = z.infer<typeof GetTaskTreeResponseSchema>;
