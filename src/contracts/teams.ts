import { z } from 'zod';
export const MAX_TEAM_REQUEST_BYTES = 64 * 1024;
const uuid = z.string().uuid();
const timestamp = z.iso.datetime({ offset: true });
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
    execution_mode: z.enum([
      'legacy_graph',
      'collaborative_mve',
      'agentic_mve',
    ]),
    environment_version_id: uuid.nullable(),
    collaboration_spec: z.unknown().nullable(),
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
    execution_mode: z.enum(['collaborative_mve', 'agentic_mve']).nullable(),
    control_state: z
      .enum(['lead_ready', 'lead_running', 'member_work_running', 'terminal'])
      .nullable(),
    revision: z.number().int(),
    lead_turn_count: z.number().int(),
    stop_reason: z.string().nullable(),
    completion_requested_by_run_id: uuid.nullable(),
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
