import { z } from 'zod';
export const MAX_TEAM_REQUEST_BYTES = 64 * 1024;
const uuid = z.string().uuid();
const timestamp = z.iso.datetime({ offset: true });
const decisionTarget = z
  .object({
    work_item_id: uuid,
    attempt_no_at_decision: z.number().int().positive(),
  })
  .strict();
export const TeamCompletionDecisionRequestSchema = z.discriminatedUnion(
  'decision',
  [
    z
      .object({
        decision: z.literal('approve'),
        expected_revision: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        decision: z.literal('reject'),
        expected_revision: z.number().int().nonnegative(),
        feedback: z.string().trim().min(1).max(4096),
        work_item_ids: z
          .array(uuid)
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
export const TeamCompletionDecisionResponseSchema = z
  .object({
    id: uuid,
    team_run_id: uuid,
    completion_requested_by_run_id: uuid,
    decision: z.enum(['approve', 'reject']),
    feedback: z.string().nullable(),
    decided_by: z.string().min(1),
    decided_at: timestamp,
    team_revision_at_decision: z.number().int().nonnegative(),
    lead_turn_count_at_decision: z.number().int().nonnegative(),
    targets: z.array(decisionTarget),
  })
  .strict();
export const TeamCompletionDecisionResultResponseSchema = z
  .object({
    decision: TeamCompletionDecisionResponseSchema,
    team_run: z.lazy(() => TeamRunResponseSchema),
  })
  .strict();
export const TeamPackageRequestSchema = z
  .object({ source: z.string() })
  .strict();
export const PublishTeamVersionRequestSchema = z.object({}).strict();
const links = z.record(z.string(), z.string()).optional();
export const TeamDefinitionResponseSchema = z
  .object({
    id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    links,
  })
  .strict();
export const TeamVersionResponseSchema = z
  .object({
    id: uuid,
    definition_id: uuid,
    status: z.enum(['draft', 'published']),
    name: z.string(),
    description: z.string().nullable(),
    environment_version_id: uuid,
    spec: z
      .object({
        lead: z
          .object({ name: z.string().trim().min(1), agentVersionId: uuid })
          .strict(),
        roster: z
          .array(
            z
              .object({ name: z.string().trim().min(1), agentVersionId: uuid })
              .strict(),
          )
          .min(1),
        environmentVersionId: uuid,
      })
      .strict()
      .superRefine((spec, context) => {
        const names = [
          spec.lead.name,
          ...spec.roster.map((member) => member.name),
        ];
        if (new Set(names).size !== names.length)
          context.addIssue({
            code: 'custom',
            message: 'Team member names must be unique',
          });
      }),
    created_at: timestamp,
    updated_at: timestamp,
    published_at: timestamp.nullable(),
    links,
  })
  .strict();
export const TeamImportResponseSchema = z
  .object({
    result: z.enum(['created', 'converged', 'replayed']),
    team: TeamDefinitionResponseSchema,
    version: TeamVersionResponseSchema,
  })
  .strict();
export const TeamVersionListResponseSchema = z
  .object({
    items: z.array(TeamVersionResponseSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();
export const TeamRunResponseSchema = z
  .object({
    id: uuid,
    root_task_id: uuid,
    root_run_id: uuid,
    team_version_id: uuid,
    environment_version_id: uuid,
    status: z.enum(['active', 'waiting', 'succeeded', 'failed']),
    phase: z.enum(['lead_kickoff', 'member_work', 'lead_finalize', 'done']),
    final_text: z.string().nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    control_state: z
      .enum(['lead_ready', 'lead_running', 'member_work_running', 'terminal'])
      .nullable(),
    revision: z.number().int(),
    lead_turn_count: z.number().int(),
    stop_reason: z.string().nullable(),
    completion_requested_by_run_id: uuid.nullable(),
    completion_approval_required: z.boolean(),
    completion_decisions: z.array(TeamCompletionDecisionResponseSchema),
  })
  .strict();
export const TeamMemberResponseSchema = z
  .object({
    id: uuid,
    team_run_id: uuid,
    name: z.string(),
    role: z.enum(['lead', 'member']),
    agent_version_id: uuid,
    runtime_session_id: uuid.nullable(),
    status: z.enum(['starting', 'active', 'idle', 'stopped', 'failed']),
    current_work_item_id: uuid.nullable(),
    created_at: timestamp,
    updated_at: timestamp,
  })
  .strict();
export const TeamWorkItemResponseSchema = z
  .object({
    id: uuid,
    team_run_id: uuid,
    subject: z.string(),
    description: z.string().nullable(),
    status: z.enum([
      'pending',
      'in_progress',
      'completed',
      'blocked',
      'cancelled',
      'open',
      'accepted',
    ]),
    owner_member_id: uuid.nullable(),
    created_by_member_id: uuid,
    completion_summary: z.string().nullable(),
    execution_task_id: uuid.nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: timestamp.nullable(),
  })
  .strict();
export const TeamWorkItemAttemptResponseSchema = z
  .object({
    id: uuid,
    work_item_id: uuid,
    team_run_id: uuid,
    attempt_no: z.number().int(),
    assignee_member_id: uuid,
    requested_by_lead_task_id: uuid,
    feedback: z.string().nullable(),
    execution_task_id: uuid.nullable(),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    result_summary: z.string().nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: timestamp.nullable(),
  })
  .strict();

export const AgenticTeamProjectTurnSchema = z
  .object({
    task_id: uuid,
    run_id: uuid,
    sequence: z.number().int(),
    kind: z.enum(['lead_turn', 'work_attempt', 'direct_message']),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    context: z.string(),
    result_text: z.string().nullable(),
    work_item_id: uuid.nullable(),
    attempt_id: uuid.nullable(),
    attempt_no: z.number().int().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    created_at: timestamp,
    updated_at: timestamp,
  })
  .strict();

export const AgenticTeamProjectSessionSchema = z
  .object({
    team_member_run_id: uuid,
    name: z.string(),
    role: z.enum(['lead', 'member']),
    status: z.enum(['starting', 'active', 'idle', 'stopped', 'failed']),
    turns: z.array(AgenticTeamProjectTurnSchema),
  })
  .strict();

const AgenticTeamProjectResponseBaseSchema = z
  .object({
    stuck: z
      .boolean()
      .describe(
        "True exactly when team.status='active' && no_active_attempts && all_members_idle && !all_work_accepted.",
      ),
    project: z
      .object({
        root_task_id: uuid,
        team_run_id: uuid,
        team_version_id: uuid,
        status: z.enum(['active', 'waiting', 'succeeded', 'failed']),
        phase: z.enum(['lead_kickoff', 'member_work', 'lead_finalize', 'done']),
        final_text: z.string().nullable(),
        revision: z.number().int(),
        stop_reason: z.string().nullable(),
        completion_approval_required: z.boolean(),
        completion_decisions: z.array(TeamCompletionDecisionResponseSchema),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .strict()
      .nullable(),
    work_items: z.array(
      z
        .object({
          work_ref: z.string().regex(/^work-\d+$/),
          subject: z.string(),
          description: z.string().nullable(),
          status: TeamWorkItemResponseSchema.shape.status,
          assignee_name: z.string().nullable(),
          dependency_refs: z.array(z.string().regex(/^work-\d+$/)),
          attempts: z.array(
            z
              .object({
                attempt_no: z.number().int(),
                status: z.enum(['queued', 'running', 'completed', 'failed']),
                feedback_summary: z.string().nullable(),
                result_summary: z.string().nullable(),
              })
              .strict(),
          ),
          latest_attempt: z
            .object({
              attempt_no: z.number().int(),
              status: z.enum(['queued', 'running', 'completed', 'failed']),
              feedback_summary: z.string().nullable(),
              result_summary: z.string().nullable(),
            })
            .nullable(),
        })
        .strict(),
    ),
    gates: z
      .object({
        finish_ready: z.boolean(),
        all_work_accepted: z.boolean(),
        no_active_attempts: z.boolean(),
        all_members_idle: z.boolean(),
      })
      .strict(),
    direct_messages: z.array(
      z
        .object({
          sequence: z.number().int().positive(),
          sender_name: z.string(),
          recipient_name: z.string(),
          summary: z.string(),
          status: z.enum(['presented', 'acknowledged']),
          created_at: timestamp,
        })
        .strict(),
    ),
    sessions: z.array(AgenticTeamProjectSessionSchema),
  })
  .strict();

export const AgenticTeamProjectResponseSchema = z.discriminatedUnion(
  'decision_capture_status',
  [
    AgenticTeamProjectResponseBaseSchema.extend({
      decision_capture_status: z.literal('not_captured'),
    }).strict(),
    AgenticTeamProjectResponseBaseSchema.extend({
      decision_capture_status: z.literal('reported'),
      decisions: z.array(TeamCompletionDecisionResponseSchema),
    }).strict(),
  ],
);

export type AgenticTeamProjectResponse = z.infer<
  typeof AgenticTeamProjectResponseSchema
>;

export const TeamDirectMessageResponseSchema = z
  .object({
    sequence: z.number().int().positive(),
    sender_name: z.string(),
    recipient_name: z.string(),
    summary: z.string(),
    status: z.enum(['presented', 'acknowledged']),
    created_at: timestamp,
  })
  .strict();
