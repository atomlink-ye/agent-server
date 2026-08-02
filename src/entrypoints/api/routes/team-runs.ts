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
} from '../../../contracts/teams.js';
import {
  getAuthenticatedAccessContext,
  requireServiceAccountAccess,
} from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { z } from 'zod';
import { ProjectAgenticTeam } from '../../../application/teams/project-agentic-team.js';
import { AgenticTeamProjectResponseSchema } from '../../../contracts/teams.js';
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
    if (!projection) return c.json({ project: null }, 200);
    return c.json(
      AgenticTeamProjectResponseSchema.parse({
        project: {
          root_task_id: projection.project.rootTaskId,
          team_run_id: projection.project.teamRunId,
          team_version_id: projection.project.teamVersionId,
          status: projection.project.status,
          final_text: projection.project.finalText,
          created_at: projection.project.createdAt,
          updated_at: projection.project.updatedAt,
        },
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
            created_at: turn.createdAt,
            updated_at: turn.updatedAt,
          })),
        })),
      }),
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
    execution_mode: v.executionMode,
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
