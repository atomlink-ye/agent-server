import { z } from 'zod';

import { ProductSourceRefsSchema } from '../product-source-refs.js';

const RequiredMessageRefsSchema = ProductSourceRefsSchema.pick({
  team_run_id: true,
  team_message_id: true,
})
  .required()
  .strict();

const RequiredTeamRunRefsSchema = ProductSourceRefsSchema.pick({
  team_run_id: true,
})
  .required()
  .strict();

const RequiredAttemptRefsSchema = ProductSourceRefsSchema.pick({
  team_run_id: true,
  task_id: true,
})
  .required()
  .strict();

/**
 * A product edge is a typed statement about one source row. The variants do
 * not share a synthetic tuple: only team messages have a source sequence.
 */
export const ProductObservedMessageEdgeSchema = z
  .object({
    kind: z.literal('observed_message'),
    guarantee: z.literal('ordered_observation'),
    message_id: z.uuid(),
    sender_actor_id: z.uuid().nullable(),
    recipient_actor_id: z.uuid(),
    work_item_id: z.uuid().nullable(),
    attempt_id: z.uuid().nullable(),
    sequence: z.number().int().positive(),
    source_created_at: z.string().datetime(),
    source_refs: RequiredMessageRefsSchema,
  })
  .strict();

export const ProductDeclaredDependencyEdgeSchema = z
  .object({
    kind: z.literal('declared_dependency'),
    guarantee: z.literal('declared_relation'),
    dependent_work_item_id: z.uuid(),
    prerequisite_work_item_id: z.uuid(),
    source_created_at: z.string().datetime(),
    source_refs: RequiredTeamRunRefsSchema,
  })
  .strict();

export const ProductAssignmentEdgeSchema = z
  .object({
    kind: z.literal('assignment'),
    guarantee: z.literal('derived_relation'),
    work_item_id: z.uuid(),
    attempt_id: z.uuid(),
    assignee_actor_id: z.uuid(),
    source_created_at: z.string().datetime(),
    source_refs: RequiredAttemptRefsSchema,
  })
  .strict();

export const ProductFeedbackEdgeSchema = z
  .object({
    kind: z.literal('feedback'),
    guarantee: z.literal('derived_relation'),
    work_item_id: z.uuid(),
    attempt_id: z.uuid(),
    reviewer_actor_id: z.uuid().nullable(),
    source_created_at: z.string().datetime(),
    source_refs: RequiredAttemptRefsSchema,
  })
  .strict();

export const ProductTraceEdgeSchema = z.discriminatedUnion('kind', [
  ProductObservedMessageEdgeSchema,
  ProductDeclaredDependencyEdgeSchema,
  ProductAssignmentEdgeSchema,
  ProductFeedbackEdgeSchema,
]);

export type ProductObservedMessageEdge = z.infer<
  typeof ProductObservedMessageEdgeSchema
>;
export type ProductDeclaredDependencyEdge = z.infer<
  typeof ProductDeclaredDependencyEdgeSchema
>;
export type ProductAssignmentEdge = z.infer<typeof ProductAssignmentEdgeSchema>;
export type ProductFeedbackEdge = z.infer<typeof ProductFeedbackEdgeSchema>;
export type ProductTraceEdge = z.infer<typeof ProductTraceEdgeSchema>;

function compareTuple(
  left: {
    source_created_at: string;
    source_refs: { team_run_id: string };
    sequence?: number;
  },
  right: {
    source_created_at: string;
    source_refs: { team_run_id: string };
    sequence?: number;
  },
): number {
  return (
    left.source_created_at.localeCompare(right.source_created_at) ||
    left.source_refs.team_run_id.localeCompare(right.source_refs.team_run_id) ||
    (left.sequence ?? 0) - (right.sequence ?? 0)
  );
}

/**
 * Edges are a stable display merge. Across runs this is a time ordering only;
 * it does not claim a causal order between rows from different runs.
 */
export const ProductTraceEdgesSchema = z
  .array(ProductTraceEdgeSchema)
  .superRefine((edges, ctx) => {
    for (let index = 1; index < edges.length; index += 1) {
      if (compareTuple(edges[index - 1]!, edges[index]!) > 0) {
        ctx.addIssue({
          code: 'custom',
          message:
            'edges must be sorted by (source_created_at, source_refs.team_run_id, sequence)',
          path: [index],
        });
      }
    }
  });

/**
 * Execution events use the same stable display merge. Across runs this is a
 * time ordering only; it does not claim a causal order between runs.
 */
export const ExecutionEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: z.enum(['started', 'output', 'succeeded', 'failed', 'cancelled']),
    payload_capture_status: z.enum(['not_present', 'redacted']),
    source_refs: ProductSourceRefsSchema.pick({
      root_task_id: true,
      task_id: true,
      run_id: true,
    })
      .partial()
      .extend({ run_id: z.uuid() })
      .strict(),
    created_at: z.string().datetime(),
  })
  .strict();

export const ExecutionEventsSchema = z
  .array(ExecutionEventSchema)
  .superRefine((events, ctx) => {
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1]!;
      const current = events[index]!;
      if (
        previous.created_at.localeCompare(current.created_at) > 0 ||
        (previous.created_at === current.created_at &&
          (previous.source_refs.run_id!.localeCompare(
            current.source_refs.run_id!,
          ) > 0 ||
            (previous.source_refs.run_id === current.source_refs.run_id &&
              previous.sequence > current.sequence)))
      ) {
        ctx.addIssue({
          code: 'custom',
          message:
            'events must be sorted by (created_at, source_refs.run_id, sequence)',
          path: [index],
        });
      }
    }
  });

export const ExecutionRunSchema = z
  .object({
    status: z.enum([
      'queued',
      'running',
      'waiting_children',
      'succeeded',
      'failed',
      'timed_out',
      'cancelled',
    ]),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    result_capture_status: z.enum(['not_present', 'redacted']),
    error_code: z.string().nullable(),
    actor_id: z.uuid().nullable(),
    work_item_id: z.uuid().nullable(),
    source_refs: ProductSourceRefsSchema,
    started_at: z.string().datetime().nullable(),
    ended_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

const McpActivitySourceRefsSchema = z
  .object({
    root_task_id: z.uuid(),
    task_id: z.uuid(),
    run_id: z.uuid(),
    actor_id: z.uuid().optional(),
    work_item_id: z.uuid().optional(),
  })
  .strict();

const McpActivityChatDetailSchema = z
  .object({
    method: z.literal('GET'),
    path: z.string().min(1),
    target: z
      .object({
        run_id: z.uuid(),
        sequence: z.number().int().positive(),
        activity_id: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const McpActivityBaseSchema = z
  .object({
    activity_id: z.string().min(1),
    sequence: z.number().int().positive(),
    provenance: z.literal('server_authorized_team_mcp_catalog'),
    tool_identity_capture_status: z.literal('present'),
    operation_capture_status: z.enum(['present', 'not_present']),
    result_capture_status: z.enum(['not_present', 'redacted']),
    source_refs: McpActivitySourceRefsSchema,
    chat_detail: McpActivityChatDetailSchema,
  })
  .strict();

export const McpToolActivitySchema = McpActivityBaseSchema.extend({
  kind: z.literal('tool_status'),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  category: z.enum([
    'shell',
    'read',
    'edit',
    'write',
    'search',
    'fetch',
    'subagent',
    'other',
  ]),
  tool_name: z.string().min(1),
}).strict();

export const McpActivitySchema = McpToolActivitySchema;

export const McpActivitiesSchema = z
  .array(McpActivitySchema)
  .superRefine((activities, ctx) => {
    for (let index = 1; index < activities.length; index += 1) {
      const previous = activities[index - 1]!;
      const current = activities[index]!;
      const previousRun = previous.source_refs.run_id;
      const currentRun = current.source_refs.run_id;
      if (
        previousRun.localeCompare(currentRun) > 0 ||
        (previousRun === currentRun &&
          (previous.sequence > current.sequence ||
            (previous.sequence === current.sequence &&
              previous.activity_id.localeCompare(current.activity_id) > 0)))
      ) {
        ctx.addIssue({
          code: 'custom',
          message:
            'mcp_activities must be sorted by (source_refs.run_id, sequence, activity_id)',
          path: [index],
        });
      }
    }
  });

export const TimelineCoverageSchema = z
  .object({
    scope: z.literal('mcp_dispatch_and_confirmation'),
    completeness: z.literal('mcp_only'),
    excluded_execution: z.tuple([
      z.literal('direct_shell'),
      z.literal('direct_file_edit'),
      z.literal('other_non_mcp_execution'),
    ]),
  })
  .strict();

export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;
export type ExecutionRun = z.infer<typeof ExecutionRunSchema>;
export type McpActivity = z.infer<typeof McpActivitySchema>;
