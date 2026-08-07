import type { Hono } from 'hono';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import type {
  TeamExecutionRepository,
  OwnerScope,
} from '../../../application/ports/team-execution-repository.js';
import { HttpError } from '../../../contracts/http.js';
import {
  TeamRunResponseSchema,
  TeamMemberResponseSchema,
  TeamWorkItemResponseSchema,
  TeamDirectMessageResponseSchema,
} from '../../../contracts/teams.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { z } from 'zod';
import {
  ProjectAgenticTeam,
  type AgenticTeamProject,
} from '../../../application/teams/project-agentic-team.js';
import {
  AgenticTeamProjectResponseSchema,
  type AgenticTeamProjectResponse,
} from '../../../contracts/teams.js';

export function toAgenticTeamProjectResponse(
  projection: AgenticTeamProject | null,
): AgenticTeamProjectResponse {
  if (!projection)
    return {
      project: null,
      work_items: [],
      gates: {
        finish_ready: false,
        all_work_accepted: false,
        no_active_attempts: true,
        all_members_idle: true,
      },
      direct_messages: [],
      sessions: [],
    };
  return {
    project: {
      root_task_id: projection.project.rootTaskId,
      team_run_id: projection.project.teamRunId,
      team_version_id: projection.project.teamVersionId,
      status: projection.project.status,
      phase: projection.project.phase,
      final_text: projection.project.finalText,
      revision: projection.project.revision,
      stop_reason: projection.project.stopReason,
      created_at: projection.project.createdAt,
      updated_at: projection.project.updatedAt,
    },
    work_items: projection.workItems.map((work) => ({
      work_ref: work.workRef,
      subject: work.subject,
      description: work.description,
      status:
        work.status as AgenticTeamProjectResponse['work_items'][number]['status'],
      assignee_name: work.assigneeName,
      dependency_refs: [...work.dependencyRefs],
      attempts: work.attempts.map((attempt) => ({
        attempt_no: attempt.attemptNo,
        status: attempt.status,
        feedback_summary: attempt.feedbackSummary,
        result_summary: attempt.resultSummary,
      })),
      latest_attempt: work.latestAttempt
        ? {
            attempt_no: work.latestAttempt.attemptNo,
            status: work.latestAttempt.status,
            feedback_summary: work.latestAttempt.feedbackSummary,
            result_summary: work.latestAttempt.resultSummary,
          }
        : null,
    })),
    gates: {
      finish_ready: projection.gates.finishReady,
      all_work_accepted: projection.gates.allWorkAccepted,
      no_active_attempts: projection.gates.noActiveAttempts,
      all_members_idle: projection.gates.allMembersIdle,
    },
    direct_messages: projection.directMessages.map((message) => ({
      sequence: message.sequence,
      sender_name: message.senderName,
      recipient_name: message.recipientName,
      summary: message.summary,
      status: message.status,
      created_at: message.createdAt,
    })),
    sessions: projection.sessions.map((session) => ({
      team_member_run_id: session.teamMemberRunId,
      name: session.name,
      role: session.role,
      status: session.status,
      turns: session.turns.map((turn) => ({
        task_id: turn.taskId,
        run_id: turn.runId,
        sequence: turn.sequence,
        kind: turn.kind,
        status: turn.status,
        context: turn.context,
        result_text: turn.resultText,
        work_item_id: turn.workItemId,
        attempt_id: turn.attemptId,
        attempt_no: turn.attemptNo,
        provider: turn.provider,
        model: turn.model,
        created_at: turn.createdAt,
        updated_at: turn.updatedAt,
      })),
    })),
  };
}
export function registerTeamRunRoutes(
  app: Hono<ApiEnvironment>,
  d: {
    config: AppConfig;
    teamExecutions: TeamExecutionRepository;
    projectAgenticTeam: ProjectAgenticTeam;
  },
): void {
  const auth = new ServiceAccountAuthenticator(d.config.serviceAccounts ?? []);
  for (const p of ['/api/v1/tasks/*/team-run', '/api/v1/team-runs/*'])
    app.use(p, requireServiceAccountAccess(auth));
  app.use('/api/v1/team-runs:project', requireServiceAccountAccess(auth));
  app.get('/api/v1/team-runs:project', async (c) => {
    const rootTaskId = c.req.query('root_task_id');
    if (rootTaskId && !z.uuid().safeParse(rootTaskId).success)
      throw new HttpError(
        400,
        'invalid_root_task_id',
        'The root task ID is invalid.',
      );
    const projection = await d.projectAgenticTeam.execute(owner(c), rootTaskId);
    return c.json(
      AgenticTeamProjectResponseSchema.parse(
        toAgenticTeamProjectResponse(projection),
      ),
      200,
    );
  });
  app.get('/api/v1/tasks/:taskId/team-run', async (c) => {
    const r = await d.teamExecutions.findTeamRunByRootTaskId(
      c.req.param('taskId'),
      owner(c),
    );
    return c.json(r ? run(r) : null, 200);
  });
  app.get('/api/v1/team-runs/:id', async (c) => {
    const found = await d.teamExecutions.findTeamRunById(
      c.req.param('id'),
      owner(c),
    );
    const r = required(found);
    return c.json(TeamRunResponseSchema.parse(run(r)), 200);
  });
  app.get('/api/v1/team-runs/:id/members', async (c) => {
    const found = await d.teamExecutions.findTeamRunById(
      c.req.param('id'),
      owner(c),
    );
    const r = required(found);
    return c.json(
      (await d.teamExecutions.findMembersByTeamRunId(r.id, owner(c))).map(
        member,
      ),
      200,
    );
  });
  app.get('/api/v1/team-runs/:id/tasks', async (c) => {
    const found = await d.teamExecutions.findTeamRunById(
      c.req.param('id'),
      owner(c),
    );
    const r = required(found);
    return c.json(
      (await d.teamExecutions.findWorkItemsByTeamRunId(r.id, owner(c))).map(
        work,
      ),
      200,
    );
  });
  app.get('/api/v1/team-runs/:id/direct-messages', async (c) => {
    const projection = await d.projectAgenticTeam.project(
      c.req.param('id'),
      owner(c),
    );
    if (!projection)
      throw new HttpError(404, 'team_not_found', 'The team run was not found.');
    return c.json(
      projection.directMessages.map((message) =>
        TeamDirectMessageResponseSchema.parse({
          sequence: message.sequence,
          sender_name: message.senderName,
          recipient_name: message.recipientName,
          summary: message.summary,
          status: message.status,
          created_at: message.createdAt,
        }),
      ),
      200,
    );
  });
}
function owner(c: any): OwnerScope {
  const a = getAuthenticatedAccessContext(c);
  return a;
}
function required<T>(v: T | null): T {
  if (!v)
    throw new HttpError(404, 'team_not_found', 'The team run was not found.');
  return v;
}
function run(v: any) {
  return TeamRunResponseSchema.parse({
    id: v.id,
    root_task_id: v.rootTaskId,
    root_run_id: v.rootRunId,
    team_version_id: v.teamVersionId,
    environment_version_id: v.environmentVersionId,
    status: v.status,
    phase: v.phase,
    final_text: v.finalText,
    control_state: v.controlState,
    revision: v.revision,
    lead_turn_count: v.leadTurnCount,
    stop_reason: v.stopReason,
    completion_requested_by_run_id: v.completionRequestedByRunId,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
  });
}
function member(v: any) {
  return TeamMemberResponseSchema.parse({
    id: v.id,
    team_run_id: v.teamRunId,
    name: v.name,
    role: v.role,
    agent_version_id: v.agentVersionId,
    runtime_session_id: v.runtimeSessionId,
    status: v.status,
    current_work_item_id: v.currentWorkItemId,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
  });
}
function work(v: any) {
  return TeamWorkItemResponseSchema.parse({
    id: v.id,
    team_run_id: v.teamRunId,
    subject: v.subject,
    description: v.description,
    status: v.status,
    owner_member_id: v.ownerMemberId,
    created_by_member_id: v.createdByMemberId,
    completion_summary: v.completionSummary,
    execution_task_id: v.executionTaskId,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    completed_at: v.completedAt,
  });
}
